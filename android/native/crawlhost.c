/*
 * crawlhost: runs crawl for the on-device mode, in place of the webtiles
 * server's process handling (webserver/webtiles/process_handler.py,
 * connection.py, terminal.py).
 *
 *   crawlhost <workdir> <crawl> [crawl args...]
 *
 * crawl runs in a pty (it still drives curses there; the output is thrown
 * away) with -webtiles-socket <workdir>/sock/crawl.sock -await-connection.
 * The parent attaches to that socket like the server does and talks to the
 * app over stdin/stdout, one message per line:
 *
 *   stdin   S<json>   to crawl's socket (key, click_cell, ui messages...)
 *           I<hex>    raw bytes to crawl's terminal (the "input" message)
 *   stdout  <json>    a crawl message (special ones start with '*')
 *           X <code>  crawl exited
 *
 * EOF on stdin hangs crawl up, which makes it save and exit.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>

#define RECV_MAX (512 * 1024)

static pid_t child = -1;
static int sock = -1;
static struct sockaddr_un crawl_addr;
static int attached = 0;

static char *pending = NULL; /* socket messages queued before attaching */
static size_t pending_len = 0;

static void die(const char *what)
{
    fprintf(stderr, "crawlhost: %s: %s\n", what, strerror(errno));
    exit(1);
}

static void write_all(int fd, const char *buf, size_t len)
{
    while (len > 0)
    {
        ssize_t n = write(fd, buf, len);
        if (n < 0)
        {
            if (errno == EINTR)
                continue;
            return;
        }
        buf += n;
        len -= n;
    }
}

static void send_crawl(const char *msg, size_t len)
{
    if (!attached)
    {
        pending = realloc(pending, pending_len + len + 1);
        memcpy(pending + pending_len, msg, len);
        pending[pending_len + len] = '\n';
        pending_len += len + 1;
        return;
    }
    if (sendto(sock, msg, len, 0, (struct sockaddr *)&crawl_addr,
               sizeof(crawl_addr)) < 0)
        fprintf(stderr, "crawlhost: sendto: %s\n", strerror(errno));
}

static void try_attach(void)
{
    struct stat st;
    if (attached || stat(crawl_addr.sun_path, &st) != 0)
        return;
    attached = 1;
    static const char attach[] = "{\"msg\":\"attach\",\"primary\":true}";
    send_crawl(attach, sizeof(attach) - 1);
    char *p = pending;
    while (p && p < pending + pending_len)
    {
        char *nl = memchr(p, '\n', pending + pending_len - p);
        send_crawl(p, nl - p);
        p = nl + 1;
    }
    free(pending);
    pending = NULL;
    pending_len = 0;
}

static int hexval(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static void handle_line(int pty, char *line, size_t len)
{
    if (len == 0)
        return;
    if (line[0] == 'S')
        send_crawl(line + 1, len - 1);
    else if (line[0] == 'I')
    {
        size_t n = 0;
        for (size_t i = 1; i + 1 < len; i += 2)
        {
            int hi = hexval(line[i]), lo = hexval(line[i + 1]);
            if (hi < 0 || lo < 0)
                break;
            line[n++] = (char)(hi * 16 + lo);
        }
        write_all(pty, line, n);
    }
}

/* Same framing as connection.py: crawl ends every message with '\n'; a
 * datagram without one is a fragment of a bigger message. */
static char *msgbuf = NULL;
static size_t msg_len = 0, msg_cap = 0;

static void handle_datagram(const char *data, size_t len)
{
    if (msg_len + len > msg_cap)
    {
        msg_cap = (msg_len + len) * 2;
        msgbuf = realloc(msgbuf, msg_cap);
    }
    memcpy(msgbuf + msg_len, data, len);
    msg_len += len;
    if (msg_len == 0 || msgbuf[msg_len - 1] != '\n')
        return;
    /* one message per output line: newlines inside are JSON whitespace */
    for (size_t i = 0; i + 1 < msg_len; i++)
        if (msgbuf[i] == '\n' || msgbuf[i] == '\r')
            msgbuf[i] = ' ';
    write_all(1, msgbuf, msg_len);
    msg_len = 0;
}

static void spawn(char *crawl, char **args, int nargs, const char *sockpath,
                  int *master_out)
{
    int master = posix_openpt(O_RDWR | O_NOCTTY);
    if (master < 0 || grantpt(master) < 0 || unlockpt(master) < 0)
        die("pty");
    char *slave_name = ptsname(master);

    child = fork();
    if (child < 0)
        die("fork");
    if (child == 0)
    {
        setsid();
        int slave = open(slave_name, O_RDWR);
        if (slave < 0)
            _exit(127);
        ioctl(slave, TIOCSCTTY, 0);
        struct winsize ws = { .ws_row = 24, .ws_col = 80 };
        ioctl(slave, TIOCSWINSZ, &ws);
        dup2(slave, 0);
        dup2(slave, 1);
        int err = open("crawl.err", O_WRONLY | O_CREAT | O_TRUNC, 0644);
        dup2(err >= 0 ? err : slave, 2);
        for (int fd = 3; fd < 256; fd++)
            close(fd);
        setenv("TERM", "xterm-256color", 1);
        setenv("COLUMNS", "80", 1);
        setenv("LINES", "24", 1);
        setenv("LANG", "C.UTF-8", 1);

        char **argv = calloc(nargs + 5, sizeof(char *));
        int n = 0;
        argv[n++] = crawl;
        for (int i = 0; i < nargs; i++)
            argv[n++] = args[i];
        argv[n++] = "-webtiles-socket";
        argv[n++] = (char *)sockpath;
        argv[n++] = "-await-connection";
        argv[n] = NULL;
        execv(crawl, argv);
        _exit(127);
    }
    *master_out = master;
}

int main(int argc, char **argv)
{
    if (argc < 3)
    {
        fprintf(stderr, "usage: crawlhost <workdir> <crawl> [args...]\n");
        return 2;
    }
    if (chdir(argv[1]) < 0)
        die("chdir");
    signal(SIGPIPE, SIG_IGN);
    mkdir("sock", 0700);

    char sockpath[256];
#ifdef __CYGWIN__
    /* sun_path holds 108 bytes; a deep install path wouldn't fit */
    snprintf(sockpath, sizeof(sockpath), "sock/crawl.sock");
#else
    snprintf(sockpath, sizeof(sockpath), "%s/sock/crawl.sock", argv[1]);
#endif
    unlink(sockpath);
    memset(&crawl_addr, 0, sizeof(crawl_addr));
    crawl_addr.sun_family = AF_UNIX;
    strncpy(crawl_addr.sun_path, sockpath, sizeof(crawl_addr.sun_path) - 1);

    sock = socket(AF_UNIX, SOCK_DGRAM, 0);
    if (sock < 0)
        die("socket");
    int rcv = 4 * 1024 * 1024, snd = 256 * 1024;
    setsockopt(sock, SOL_SOCKET, SO_RCVBUF, &rcv, sizeof(rcv));
    setsockopt(sock, SOL_SOCKET, SO_SNDBUF, &snd, sizeof(snd));
    struct sockaddr_un own;
    memset(&own, 0, sizeof(own));
    own.sun_family = AF_UNIX;
#ifdef __CYGWIN__
    snprintf(own.sun_path, sizeof(own.sun_path), "sock/host.sock");
#else
    snprintf(own.sun_path, sizeof(own.sun_path), "%s/sock/host.sock", argv[1]);
#endif
    unlink(own.sun_path);
    if (bind(sock, (struct sockaddr *)&own, sizeof(own)) < 0)
        die("bind");

    int master;
    spawn(argv[2], argv + 3, argc - 3, sockpath, &master);

    char *line = malloc(RECV_MAX);
    size_t line_len = 0;
    char *dgram = malloc(RECV_MAX);
    char ptybuf[4096];
    int stdin_open = 1, pty_open = 1;

    for (;;)
    {
        struct pollfd fds[3] = {
            { .fd = stdin_open ? 0 : -1, .events = POLLIN },
            { .fd = pty_open ? master : -1, .events = POLLIN },
            { .fd = sock, .events = POLLIN },
        };
        int r = poll(fds, 3, attached ? 1000 : 50);
        if (r < 0 && errno != EINTR)
            die("poll");

        try_attach();

        if (fds[2].revents & POLLIN)
        {
            ssize_t n = recv(sock, dgram, RECV_MAX, MSG_DONTWAIT);
            if (n > 0)
                handle_datagram(dgram, n);
        }
        if (fds[1].revents & (POLLIN | POLLHUP | POLLERR))
        {
            /* drain the curses output so crawl never blocks on it */
            if (read(master, ptybuf, sizeof(ptybuf)) <= 0)
                pty_open = 0; /* EIO once crawl has closed the terminal */
        }
        if (fds[0].revents & (POLLIN | POLLHUP))
        {
            ssize_t n = read(0, line + line_len, RECV_MAX - line_len);
            if (n <= 0)
            {
                stdin_open = 0;
                kill(child, SIGHUP); /* crawl saves and exits */
            }
            else
            {
                line_len += n;
                char *start = line, *nl;
                while ((nl = memchr(start, '\n', line + line_len - start)))
                {
                    handle_line(master, start, nl - start);
                    start = nl + 1;
                }
                line_len = line + line_len - start;
                memmove(line, start, line_len);
                if (line_len == RECV_MAX) /* oversized line: drop it */
                    line_len = 0;
            }
        }

        int status;
        if (waitpid(child, &status, WNOHANG) == child)
        {
            /* pick up anything crawl sent just before exiting */
            ssize_t n;
            while ((n = recv(sock, dgram, RECV_MAX, MSG_DONTWAIT)) > 0)
                handle_datagram(dgram, n);
            char done[32];
            int code = WIFEXITED(status) ? WEXITSTATUS(status)
                                         : 128 + WTERMSIG(status);
            int len = snprintf(done, sizeof(done), "X %d\n", code);
            write_all(1, done, len);
            unlink(own.sun_path);
            return 0;
        }
    }
}

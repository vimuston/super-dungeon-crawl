// Auto-explore pace: a settings slider for crawl's explore_delay option (ms
// between explore steps), so the map can be watched filling in. crawl takes
// it at runtime through the webtiles "set_option" message; options set that
// way last only for the running game, so it is re-sent at every game start.
define(["comm", "./sdc_api"], function (comm, api) {
    "use strict";

    api.register_option({ key: "explore_delay", label: "Auto-explore delay (ms)",
                          default: 20, range: { min: 0, max: 200, step: 10 },
                          hint: ["Higher = slower, to watch the map fill in",
                                 "Higher = slower, to watch the map fill in"] });

    function send()
    {
        var ms = Math.round(Number(api.get("explore_delay")));
        if (!isFinite(ms)) return;
        try
        {
            comm.send_message("set_option", { line: "explore_delay = " + ms });
        }
        catch (e) { api.warn("explore delay", e); }   // socket closed
    }

    api.on("game_init", send);
    api.on("setting", function (key) {
        if (key === "explore_delay") send();
    });
});

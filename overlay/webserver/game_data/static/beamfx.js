// Orb of Destruction trail (S13). The orb is a slow monster (name "orb of
// destruction", tile MONS_ORB_OF_DESTRUCTION): while one is visible we draw a
// pulsing violet-white glow on it, a fading trail on its previous cells and,
// when it disappears, an explosion ring where it was last seen. Orbs are
// matched between scans by nearest position. (Light for the orb already
// comes from light.js's MONS_ORB_OF_DESTRUCTION rule; the light source is
// single-owner, so nothing is added here.)
//
// The bolt path streaks (X2) that used to live here were removed: they did
// not look good on wands, breaths or bolts.
//
// Debug (browser console):
//   sdc_beamfx_test("orb")             fake orb moving east from the player
//                                      for ~4s, then explosion
define(["./sdc_api", "./fxkit", "./map_knowledge"],
function (api, kit, map_knowledge) {
    "use strict";

    var ORB_RE = /orb of destruction/;
    var ORB_RGB = "205,170,255";
    var ORB_TRAIL = 7;          // trail cells kept
    var ORB_TRAIL_MS = 1100;

    var orb_dirty = false;

    function note_orb(mc)
    {
        if (mc.mon && mc.mon.name
            && ORB_RE.test(String(mc.mon.name).toLowerCase()))
            orb_dirty = true;
    }

    // a second wrapper on map_knowledge.merge, chained with light.js's
    function hook_merge()
    {
        if (map_knowledge.merge.sdc_beamfx) return;
        var orig = map_knowledge.merge;
        var wrapped = function () {
            var res = orig.apply(this, arguments);
            try
            {
                var dirty = map_knowledge.dirty();
                for (var i = 0; i < dirty.length; i++)
                {
                    var mc = map_knowledge.get(dirty[i].x, dirty[i].y);
                    if (mc) note_orb(mc);
                }
            }
            catch (e) {}
            return res;
        };
        // keep other modules' "already wrapped" markers (light.js, ...)
        for (var k in orig)
            if (/^sdc_/.test(k)) wrapped[k] = orig[k];
        wrapped.sdc_beamfx = true;
        map_knowledge.merge = wrapped;
    }

    function dist(a, b)
    {
        var dx = a.x - b.x, dy = a.y - b.y;
        return dx * dx + dy * dy;
    }

    // Orb of Destruction ----------------------------------------------------
    var orbs = [];              // [{x, y, glow, trail: [{x, y, t, el}], seen}]
    var orb_scan_t = 0;
    var fake_orbs = null;       // debug: [{x, y}] replacing the real scan

    function orb_positions()
    {
        if (fake_orbs) return fake_orbs;
        return kit.monsters().filter(function (m) {
            return ORB_RE.test(m.name);
        });
    }

    function orb_glow(host, cw)
    {
        return kit.mk(host, "width:" + cw * 2.2 + "px;height:" + cw * 2.2
            + "px;margin:" + (-cw * 1.1) + "px 0 0 " + (-cw * 1.1)
            + "px;border-radius:50%;background:radial-gradient(circle,"
            + "rgba(255,255,255,0.8) 0," + kit.rgba(ORB_RGB, 0.6) + " 30%,"
            + kit.rgba(ORB_RGB, 0) + " 70%);");
    }

    function orb_drop(o)
    {
        if (o.glow && o.glow.parentNode) o.glow.parentNode.removeChild(o.glow);
        o.trail.forEach(function (c) {
            if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
        });
        var i = orbs.indexOf(o);
        if (i >= 0) orbs.splice(i, 1);
    }

    function orb_explode(o)
    {
        var a = kit.anchor_of(o);
        if (a)
        {
            var r = kit.mk(kit.layer("beamfx"), "width:" + a.cw * 2
                + "px;height:" + a.cw * 2 + "px;margin:" + (-a.cw) + "px 0 0 "
                + (-a.cw) + "px;border-radius:50%;border:2px solid "
                + kit.rgba(ORB_RGB, 0.95) + ";box-shadow:0 0 12px "
                + kit.rgba(ORB_RGB, 0.8) + ",inset 0 0 10px "
                + kit.rgba(ORB_RGB, 0.6) + ";");
            var red = kit.reduced();
            kit.anim(r, [
                { transform: kit.at(a.x, a.y) + "scale(" + (red ? 1.6 : 0.3) + ")",
                  opacity: 1 },
                { transform: kit.at(a.x, a.y) + "scale(" + (red ? 1.6 : 2.4) + ")",
                  opacity: 0 }
            ], { duration: red ? 300 : 550 });
            setTimeout(function () {
                if (r.parentNode) r.parentNode.removeChild(r);
            }, 700);
        }
        orb_drop(o);
    }

    function orb_scan(now)
    {
        var host = kit.layer("beamfx");
        orbs.forEach(function (o) { o.seen = false; });
        orb_positions().forEach(function (p) {
            var best = null, bd = 25;       // match within 5 cells
            orbs.forEach(function (o) {
                if (o.seen) return;
                var d = dist(o, p);
                if (d < bd) { bd = d; best = o; }
            });
            if (!best)
            {
                best = { x: p.x, y: p.y, glow: null, trail: [], seen: true };
                orbs.push(best);
            }
            best.seen = true;
            if (best.x === p.x && best.y === p.y) return;
            // leave a fading trail cell at the previous position
            // The orb flies several cells per turn, so fill in the cells
            // between the two scans (older ones start slightly more faded).
            var a = kit.anchor_of(best);
            var cw = a ? a.cw : 24;
            var steps = Math.max(Math.abs(p.x - best.x), Math.abs(p.y - best.y));
            for (var s = 0; s < steps; s++)
            {
                var el = kit.mk(host, "width:" + cw * 1.3 + "px;height:"
                    + cw * 1.3 + "px;margin:" + (-cw * 0.65) + "px 0 0 "
                    + (-cw * 0.65) + "px;border-radius:50%;background:"
                    + "radial-gradient(circle," + kit.rgba(ORB_RGB, 0.7)
                    + " 0," + kit.rgba(ORB_RGB, 0) + " 70%);opacity:0;");
                best.trail.push({
                    x: Math.round(best.x + (p.x - best.x) * s / steps),
                    y: Math.round(best.y + (p.y - best.y) * s / steps),
                    t: now - (steps - s) * 40, el: el });
            }
            while (best.trail.length > ORB_TRAIL)
            {
                var old = best.trail.shift();
                if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
            }
            best.x = p.x;
            best.y = p.y;
        });
        for (var i = orbs.length - 1; i >= 0; i--)
            if (!orbs[i].seen) orb_explode(orbs[i]);
    }

    function orb_frame(now)
    {
        var host = kit.layer("beamfx");
        orbs.forEach(function (o) {
            var a = kit.anchor_of(o);
            if (!o.glow) o.glow = orb_glow(host, a ? a.cw : 24);
            if (a)
            {
                var pulse = kit.reduced() ? 1 : 1
                    + 0.12 * Math.sin(now * 0.008) + 0.06 * Math.sin(now * 0.021);
                o.glow.style.opacity = "1";
                o.glow.style.transform = kit.at(a.x, a.y)
                                         + "scale(" + pulse + ")";
            }
            else
                o.glow.style.opacity = "0";
            for (var i = o.trail.length - 1; i >= 0; i--)
            {
                var c = o.trail[i];
                var age = (now - c.t) / ORB_TRAIL_MS;
                if (age >= 1)
                {
                    if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
                    o.trail.splice(i, 1);
                    continue;
                }
                var ta = kit.anchor_of(c);
                if (!ta) { c.el.style.opacity = "0"; continue; }
                c.el.style.opacity = String(0.8 * (1 - age));
                c.el.style.transform = kit.at(ta.x, ta.y)
                                       + "scale(" + (1 - 0.5 * age) + ")";
            }
        });
    }

    api.on("frame", function () {
        try
        {
            if (!orbs.length && !orb_dirty && !fake_orbs) return;
            var n = kit.now();
            if (n - orb_scan_t > 50)
            {
                orb_scan_t = n;
                orb_dirty = false;
                orb_scan(n);
            }
            orb_frame(n);
        }
        catch (e) {}
    });

    // Lifecycle ---------------------------------------------------------------
    function reset()
    {
        orbs.slice().forEach(orb_drop);
        fake_orbs = null;
        orb_dirty = false;
    }

    api.on("game_init", function () {
        hook_merge();
        reset();
    });
    api.on("game_cleanup", reset);
    hook_merge();

    // Debug -------------------------------------------------------------------
    window.sdc_beamfx_test = function (what)
    {
        var p = kit.player_pos();
        if (!p) return "no player";
        var step = 0;
        fake_orbs = [{ x: p.x + 2, y: p.y }];
        var iv = setInterval(function () {
            step++;
            if (step > 8 || !fake_orbs)
            {
                clearInterval(iv);
                fake_orbs = null;
                return;
            }
            fake_orbs = [{ x: p.x + 2 + step, y: p.y }];
        }, 500);
        return "orb";
    };

    return {};
});

// Crawl options from the settings panel, sent at runtime through the webtiles
// "set_option" message. Options set that way last only for the running game,
// so they are re-sent at every game start.
//  - explore_delay: auto-explore pace (ms between explore steps), so the map
//    can be watched filling in.
//  - sdc_slot_pickup: autopickup of armour for empty equipment slots; read by
//    the autopickup function in crawl's dat/defaults/autopickup_exceptions.txt
//    (patches/autopickup-slots.patch). Unpatched crawl ignores it.
define(["comm", "./sdc_api"], function (comm, api) {
    "use strict";

    api.register_option({ key: "explore_delay", label: "Auto-explore delay (ms)",
                          default: 20, range: { min: 0, max: 200, step: 10 },
                          hint: ["Higher = slower, to watch the map fill in",
                                 "Higher = slower, to watch the map fill in"] });

    api.register_option({ key: "slot_pickup", label: "Pick up gear for empty slots",
                          default: "aux", tab: "Interface",
                          choices: [["off", "Off"], ["aux", "Aux armour"],
                                    ["all", "+ Shield, body"]],
                          hint: ["Auto-pick up armour for slots you have nothing worn in",
                                 "Auto-pick up armour for slots you have nothing worn in"] });

    var LINES = {
        explore_delay: function (v) {
            var ms = Math.round(Number(v));
            return isFinite(ms) ? "explore_delay = " + ms : null;
        },
        slot_pickup: function (v) {
            return /^(off|aux|all)$/.test(v) ? "sdc_slot_pickup = " + v : null;
        }
    };

    function send(key)
    {
        var line = LINES[key](api.get(key));
        if (!line) return;
        try
        {
            comm.send_message("set_option", { line: line });
        }
        catch (e) { api.warn("set_option " + key, e); }   // socket closed
    }

    api.on("game_init", function () {
        Object.keys(LINES).forEach(send);
    });
    api.on("setting", function (key) {
        if (LINES[key]) send(key);
    });
});

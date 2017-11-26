var async               = require("async"),
    wifi_manager        = require("../app/wifi_manager")(),
    dependency_manager  = require("../app/dependency_manager")(),
    config              = require("../config.json");

//Requires the following arguments to test wifi connection code:
// sudo node start_wireless.js --ssid="ssid" --pass="password"
var argv = require('minimist')(process.argv.slice(2));

var conn_info = {
  wifi_ssid:      argv.ssid,
  wifi_passcode:  argv.pass,
};

async.series([

    // 1. Check if we have the required dependencies installed
    function test_deps(next_step) {
        dependency_manager.check_deps({
            "binaries": ["dhcpd", "hostapd", "iw"],
            "files":    ["/etc/init.d/isc-dhcp-server"]
        }, function(error) {
            if (error) console.log(" * Dependency error, did you run `sudo npm run-script provision`?");
            next_step(error);
        });
    },

    // 2. Enable Wifi Connection
    function enable_rpi_wifi(next_step) {
        wifi_manager.enable_wifi_mode(conn_info, function(error) {
            if(error) {
                console.log("... Wireless Enable ERROR: " + error);
            } else {
                console.log("... Wireless Enable Success!");
            }
            next_step(error);
        });
    },
], function(error) {
    if (error) {
        console.log("ERROR: " + error);
    }
});

var async               = require("async"),
    wifi_manager        = require("../app/wifi_manager")(),
    dependency_manager  = require("../app/dependency_manager")(),
    config              = require("../config.json");
    wifi_control	= require("wifi-control");
    fs			= require("fs");

/*****************************************************************************\
    1. Check for dependencies
    5. Host a lightweight HTTP server which allows for the user to connect and
       configure the RPIs wifi connection. The interfaces exposed are RESTy so
       other applications can similarly implement their own UIs around the
       data returned.
\*****************************************************************************/
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

	function test_is_ap_enabled(next_step){
		wifi_manager.is_ap_enabled(function(error, result) {
			if(error || result==null){
				console.log("AP is not enabled: " + error);
				process.exit(0);
			} else {
				console.log("AP is enabled: " + result);
			}
			next_step(error);
		});
	},

   // 4. Host HTTP server while functioning as AP, the "api.js"
   //    file contains all the needed logic to get a basic express
   //    server up. It uses a small angular application which allows
   //    us to choose the wifi of our choosing.
   function start_http_server(next_step) {
	console.log("\nHTTP server running...");
	require("../app/api.js")(wifi_manager, next_step);
   }
], function(error) {
    if (error) {
        console.log("ERROR: " + error);
    }
});

var _       = require("underscore")._,
    async   = require("async"),
    fs      = require("fs"),
    exec    = require("child_process").exec,
    config  = require("../config.json");

// Better template format
_.templateSettings = {
    interpolate: /\{\{(.+?)\}\}/g,
    evaluate :   /\{\[([\s\S]+?)\]\}/g
};

// Helper function to write a given template to a file based on a given
// context
function write_template_to_file(template_path, file_name, context, callback) {
    async.waterfall([

        function read_template_file(next_step) {
            fs.readFile(template_path, {encoding: "utf8"}, next_step);
        },

        function update_file(file_txt, next_step) {
            var template = _.template(file_txt);
            fs.writeFile(file_name, template(context), next_step);
        }

    ], callback);
}

/*****************************************************************************\
    Return a set of functions which we can use to manage and check our wifi
    connection information
\*****************************************************************************/
module.exports = function() {
    // Detect which wifi driver we should use, the rtl871xdrv or the nl80211
    exec("iw list", function(error, stdout, stderr) {
        if (stderr.match(/^nl80211 not found/)) {
            config.wifi_driver_type = "rtl871xdrv";
        }
    });

    // Hack: this just assumes that the outbound interface will be "wlan0"

    // Define some globals
    var ifconfig_fields = {
        "hw_addr":         /HWaddr\s([^\s]+)/,
        "inet_addr":       /inet\s([^\s]+)/,
    },  iwconfig_fields = {
        "ap_addr":         /Access Point:\s([^\s]+)/,
        "ap_ssid":         /ESSID:\"([^\"]+)\"/,
        "unassociated":    /(unassociated)\s+Nick/,
	"mode":		   /Mode:([^\s]+)/,
    },  last_wifi_info = null;

    // TODO: rpi-config-ap hardcoded, should derive from a constant

    // Get generic info on an interface
    var _get_interface_info = function(interface, callback) {
        var output = {
            hw_addr:      "<unknown>",
            inet_addr:    "<unknown>",
            ap_addr:      "<unknown_ap>",
            ap_ssid:      "<unknown_ssid>",
            unassociated: "<unknown>",
	    mode:	  "<unknown>",
        };

        // Inner function which runs a given command and sets a bunch
        // of fields
        function run_command_and_set_fields(cmd, fields, callback) {
            exec(cmd, function(error, stdout, stderr) {
                if (error) return callback(error);
                for (var key in fields) {
                    re = stdout.match(fields[key]);
                    if (re && re.length > 1) {
                        output[key] = re[1];
                    }
                }
                callback(null);
            });
        }

        // Run a bunch of commands and aggregate info
        async.series([
            function run_ifconfig(next_step) {
                run_command_and_set_fields("ifconfig " + interface, ifconfig_fields, next_step);
            },
            function run_iwconfig(next_step) {
                run_command_and_set_fields("iwconfig " + interface, iwconfig_fields, next_step);
            },
        ], function(error) {
            last_wifi_info = output;
		console.log(output);
            return callback(error, output);
        });
    },

    _reboot_wireless_network = function(wlan_iface, callback) {
        async.series([
            function down(next_step) {
                exec("sudo ifdown " + wlan_iface, function(error, stdout, stderr) {
                    if (!error) console.log("ifdown " + wlan_iface + " successful...");
		    else console.log("Failed to run ifdown: " + error + stderr);
                    next_step();
                });
            },
            function up(next_step) {
                exec("sudo ifup " + wlan_iface, function(error, stdout, stderr) {
                    if (!error) console.log("ifup " + wlan_iface + " successful...");
		    else console.log("Failed to run ifup: " + error + stderr);
                    next_step();
                });
            },
        ], callback);
    },

    // Wifi related functions
    _is_wifi_enabled_sync = function(info) {
        if ("<unknown>" != info["inet_addr"]         &&
            "<unknown_ap>" != info["ap_addr"]        &&
            "<unknown_ssid>" != info["ap_ssid"]      &&
	    info["mode"].toLowerCase() == "managed"  &&
            "<unknown>" == info["unassociated"] ) {
            return info["inet_addr"];
        }
        return null;
    },

    _is_wifi_enabled = function(callback) {
        _get_interface_info(config.wifi_interface, function(error, info) {
            if (error) return callback(error, null);
            return callback(null, _is_wifi_enabled_sync(info));
        });
    },

    // Access Point related functions
    _is_ap_enabled_sync = function(info) {
        // If the current IP assigned to the chosen wireless interface is
        // the one specified for the access point in the config, we are in
        // access-point mode. 
	// Hotspot mode is generally designated by iwconfig Mode set to Master, whereas general wifi is set to Managed
        var is_ap  =
            info["inet_addr"].toLowerCase() == config.access_point.ip_addr &&
	    info["mode"].toLowerCase() == "master";
        return (is_ap) ? info["inet_addr"].toLowerCase() : null;
    },

    _is_ap_enabled = function(callback) {
	//This is defined: console.log("wifi_interface: " + config.wifi_interface);
	//TODO: Figure out why config.ap_interface is undefined: console.log("ap_interface: " + config.ap_interface);
	async.series([
            function check_interface(next_step) {
                exec("sudo ifconfig uap0 ", function(error, stdout, stderr) {
                    if (error) return callback(null,null);
                    next_step();
                });
            },
            function check_info(next_step) {
			_get_interface_info("uap0", function(error, info) {
			    if (error) return callback(error, null);
			    return callback(null, _is_ap_enabled_sync(info));
			});
            },
        ], callback);
    },

    // Enables the accesspoint w/ bcast_ssid. This assumes that both
    // isc-dhcp-server and hostapd are installed using:
    // $sudo npm run-script provision
    _enable_ap_mode = function(bcast_ssid, callback) {
        _is_ap_enabled(function(error, result_addr) {
            if (error) {
                console.log("ERROR: " + error);
                return callback(error);
            }

            if (result_addr && !config.access_point.force_reconfigure) {
                console.log("\nAccess point is enabled with ADDR: " + result_addr);
                return callback(null);
            } else if (config.access_point.force_reconfigure) {
                console.log("\nForce reconfigure enabled - reset AP");
            } else {
                console.log("\nAP is not enabled yet... enabling...");
            }

            var context = config.access_point;
            context["enable_ap"] = true;
            context["wifi_driver_type"] = config.wifi_driver_type;

            // Copy config files to the right locations before running shell script to start AP
            async.series([

                function update_interfaces(next_step) {
                    write_template_to_file(
                        config.root_dir+"/assets/etc/network/interfaces.d/ap.template",
                        "/etc/network/interfaces.d/ap",
                        context, next_step);
                },

                // Enable DHCP conf, set authoritative mode and subnet
                function update_dhcpd(next_step) {
                    // We must enable this to turn on the access point
                    write_template_to_file(
                        config.root_dir+"/assets/etc/dhcp/dhcpd.conf.template",
                        "/etc/dhcp/dhcpd.conf",
                        context, next_step);
                },

                // Enable the interface in the dhcp server
                function update_dhcp_interface(next_step) {
                    write_template_to_file(
                        config.root_dir+"/assets/etc/default/isc-dhcp-server.template",
                        "/etc/default/isc-dhcp-server",
                        context, next_step);
                },

                // Enable hostapd.conf file
                function update_hostapd_conf(next_step) {
                    write_template_to_file(
                        config.root_dir+"/assets/etc/hostapd.conf.template",
                        "/etc/hostapd.conf",
                        context, next_step);
                },

                function update_hostapd_default(next_step) {
                    write_template_to_file(
                        config.root_dir+"/assets/etc/default/hostapd.template",
                        "/etc/default/hostapd",
                        context, next_step);
                },

                function start_ap(next_step) {
                    exec("sudo bash " + config.root_dir+"/start_ap.sh", function(error, stdout, stderr) {
                        console.log(stdout);
                        if (!error) console.log("... ap started!");
			else console.log("... ap start failed! " + stderr);
                        next_step();
                    });
                }
            ], callback);
        });
    },

    _enable_wifi_mode = function(connection_info, callback) {
        _is_wifi_enabled(function(error, result_ip) {
		//Init vars for check connection. TODO: Clean up code!
		count = 0;
		timer = null;

		check_connection = function(){
			_is_wifi_enabled(function(error,result_ip){
				if(result_ip){
			                console.log("\nWifi connection is enabled with IP: " + result_ip);
					clearInterval(timer);
					return callback(null);
				} else {
					if(error) console.log("Error checking wifi connection: " + error);
					//Timeout set to 1min
					if(count > 12){
						clearInterval(timer);
						return callback("Failed to connect");
					} else {
						count++;
						console.log("Count: " + count);
						if(!timer) timer = setInterval(check_connection, 5000, count);
					}
				}
			});
		}
	    
            if (error) return callback(error);

            if (result_ip) {
                console.log("\nWifi connection is enabled with IP: " + result_ip);
                return callback(null);
            }

            async.series([
                // Update /etc/wpa_supplicant/wpa_supplicant.conf with correct info...
                function update_interfaces(next_step) {
                    write_template_to_file(
                        config.root_dir+"/assets/etc/wpa_supplicant/wpa_supplicant.conf.template",
                        "/etc/wpa_supplicant/wpa_supplicant.conf",
                        connection_info, next_step);
                },

                function reboot_network_interfaces(next_step) {
                    _reboot_wireless_network(config.wifi_interface, next_step);
                },
            ], check_connection);
        });
    };

    _disable_ap_mode = function() {
        _is_wifi_enabled(function(error, result_ip) {	    
            if (error) return callback(error);

            if (result_ip) {
                console.log("\nWifi connection is enabled with IP: " + result_ip);
            }

	exec("sudo ifdown " + config.ap_interface, function(error,stdout, stderr){
		if(!error)
		    console.log("... " + config.ap_interface + " interface shutdown");
		else
		    console.log("Failed to shutdown " + config.ap_interface + " interface" + error + stderr);
	    });
        });
    };

    return {
        get_wifi_info:           	_get_interface_info,
        reboot_wireless_network: _reboot_wireless_network,

        is_wifi_enabled:     	 _is_wifi_enabled,
        is_wifi_enabled_sync:    _is_wifi_enabled_sync,

        is_ap_enabled:	         _is_ap_enabled,
        is_ap_enabled_sync:     _is_ap_enabled_sync,

        enable_ap_mode:          _enable_ap_mode,
        enable_wifi_mode:        _enable_wifi_mode,

	disable_ap_mode:	_disable_ap_mode
    };
}

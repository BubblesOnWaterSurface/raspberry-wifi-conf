# raspberry-wifi-conf

This is a modified version which supports both a Wifi connection as well as an Access Point at the same time.

The dual wifi/AP system was taken from https://github.com/peebles/rpi3-wifi-station-ap-stretch.

A Node application which makes connecting your RaspberryPi to your home wifi easier

## Why?

When unable to connect to a wifi network, this service will turn the RPI into a wireless AP. This allows us to connect to it via a phone or other device and configure our home wifi network (for example).

Once configured, it prompts the PI to reboot with the appropriate wifi credentials. If this process fails, it immediately re-enables the PI as an AP which can be configurable again.

## Requirements

The NodeJS modules required are pretty much just `underscore`, `async`, and `express`.

The web application requires `angular`, `bootstrap` and `font-awesome` to render correctly. To make the deployment of this easy, one of the other requirements is `bower`.

If you do not have `bower` installed already, you can install it globally by running: `sudo npm install bower -g`.

## Install

```sh
$git clone https://github.com/sabhiram/raspberry-wifi-conf.git
$cd raspberry-wifi-conf
$npm update
$bower install
$sudo npm run-script provision
$sudo npm start
```

Copy/Edit the following files:

### /etc/network/interfaces.d/ap

    allow-hotplug uap0
    auto uap0
    iface uap0 inet static
        address 10.3.141.1
        netmask 255.255.255.0

### /etc/network/interfaces.d/station

    allow-hotplug wlan0
    iface wlan0 inet manual
        wpa-conf /etc/wpa_supplicant/wpa_supplicant.conf

### Do not let DHCPCD manage wpa_supplicant!!

    rm -f /lib/dhcpcd/dhcpcd-hooks/10-wpa_supplicant

### Set up the client wifi (station) on wlan0.

Create `/etc/wpa_supplicant/wpa_supplicant.conf`.  The contents depend on whether your home network is open, WEP or WPA.  It is
probably WPA, and so should look like:

    ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
    country=GB

    network={
	    ssid="_ST_SSID_"
	    scan_ssid=1
	    psk="_ST_PASSWORD_"
	    key_mgmt=WPA-PSK
    }

Replace `_ST_SSID_` with your home network SSID and `_ST_PASSWORD_` with your wifi password (in clear text). Assuming you don't know, then just ignore this.

## Restart DHCPCD

    systemctl restart dhcpcd

### Manually invoke the udev rule for the AP interface.

Execute the command below.  This will also bring up the `uap0` interface.  It will wiggle the network, so you might be kicked off (esp. if you
are logged into your Pi on wifi).  Just log back on.

    /sbin/iw phy phy0 interface add uap0 type __ap

### Install the packages you need for DNS, Access Point and Firewall rules.

    apt-get update
	apt-get install hostapd dnsmasq iptables-persistent

### /etc/dnsmasq.conf

    interface=lo,uap0
    no-dhcp-interface=lo,wlan0
    bind-interfaces
    server=8.8.8.8
    dhcp-range=10.3.141.50,10.3.141.255,12h

### /etc/default/hostapd

    DAEMON_CONF="/etc/hostapd/hostapd.conf"

### Now restart the dns and hostapd services

    systemctl restart dnsmasq
    systemctl restart hostapd

### Gotchas

#### `hostapd`

The `hostapd` application does not like to behave itself on some wifi adapters (RTL8192CU et al). This link does a good job explaining the issue and the remedy: [Edimax Wifi Issues](http://willhaley.com/blog/raspberry-pi-hotspot-ew7811un-rtl8188cus/). The gist of what you need to do is as follows:

```
# run iw to detect if you have a rtl871xdrv or nl80211 driver
$iw list
```

If the above says `nl80211 not found.` it means you are running the `rtl871xdrv` driver and probably need to update the `hostapd` binary as follows:
```
$cd raspberry-wifi-conf
$sudo mv /usr/sbin/hostapd /usr/sbin/hostapd.OLD
$sudo mv assets/bin/hostapd.rtl871xdrv /usr/sbin/hostapd
$sudo chmod 755 /usr/sbin/hostapd
```

Note that the `wifi_driver_type` config variable is defaulted to the `nl80211` driver. However, if `iw list` fails on the app startup, it will automatically set the driver type of `rtl871xdrv`. Remember that even though you do not need to update the config / default value - you will need to use the updated `hostapd` binary bundled with this app.

## Usage

This is approximately what occurs when we run this app:

1. Check to see if we are connected to a wifi AP after 10 secs to give time for a connection to be established.
2. If connected to a wifi, do nothing -> exit
3. (if not wifi, then) Allow RPI to act as an AP (with a configurable SSID)
4. Host a lightweight HTTP server which allows for the user to connect and configure the RPIs wifi connection. The interfaces exposed are RESTy so other applications can similarly implement their own UIs around the data returned.
5. Test connection with wifi once the user has input the passcode, if connected, turn of AP.
6. At this stage, the RPI is named, and has a valid wifi connection which it is now bound to.

Typically, I have the following line in my `/etc/rc.local` file:
```
cd /home/pi/raspberry-wifi-conf
sudo /usr/bin/node run.js > log.txt 2>&1
```

Note that this is run in a blocking fashion, in that this script will have to exit before we can proceed with others defined in `rc.local`. This way I can guarantee that other services which might rely on wifi will have said connection before being run. If this is not the case for you, and you just want this to run (if needed) in the background, then you can do:

```
cd /home/pi/raspberry-wifi-conf
sudo /usr/bin/node run.js > /dev/null &
```
按照Incnas的做法，我这里出现点问题：
在没有连接WIFI的情况下能够正常转换为AP模式，但httpserver没有启动。可直接在rc.local里面添加如下：
sudo /usr/bin/node /home/pi/raspberry-wifi-conf/test_runs/http_server.js > /dev/null &

## User Interface

In my config file, I have set up the static ip for my PI when in AP mode to `192.168.44.1` and the AP's broadcast SSID to `rpi-config-ap`. These are images captured from my osx dev box.

Step 1: Power on Pi which runs this app on startup (assume it is not configured for a wifi connection). Once it boots up, you will see `rpi-config-ap` among the wifi connections.  The password is configured in config.json.

<img src="https://raw.githubusercontent.com/sabhiram/public-images/master/raspberry-wifi-conf/wifi_options.png" width="200px" height="160px" />

Step 2: Join the above network, and navigate to the static IP and port we set in config.json (`http://192.168.44.1:88`), you will see:

<img src="https://raw.githubusercontent.com/sabhiram/public-images/master/raspberry-wifi-conf/ui.png" width="404px" height="222px" />

Step 3: Select your home (or whatever) network, punch in the wifi passcode if any, and click `Submit`. You are done! Your Pi is now on your home wifi!!

## Testing

The test_run folder contains the core functions seperated into individual elements. While this cannot be a substitute for proper testing, it is a stop-gap solution.

## TODO

1. Open/close login window automatically
2. Automate provisioning of the application dependencies
3. Make the running of scripts cleaner and more easy to read
5. Add tests
6. Add travis ci / coveralls hook(s)

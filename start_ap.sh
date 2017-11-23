/sbin/iw phy phy0 interface add uap0 type __ap
# Need these sleeps to give time for network to start. Suboptimal
sudo ifup uap0
sleep 5
sudo service dnsmasq restart
service hostapd restart
ifdown wlan0
sleep 2
sudo rm -f /var/run_wpa_supplicant/wlan0
ifup wlan0
sudo node run.js &

#!/bin/bash

#TODO: read wlan0 instead of hardcode

#install nodejs9
curl -sL https://deb.nodesource.com/setup_9.x | sudo -E bash -
sudo apt-get install -y nodejs

#install bower
sudo npm install -g bower

#Create virtual wlan
sudo 

#install raspberry-wifi-conf
#cd /home/pi/raspberry-wifi-conf
npm update
bower install
sudo npm run-script provision

#Shutdown dhcpcd for wlan0. TODO: Run this only when necessary
#echo "denyinterfaces wlan0" | cat - /etc/dhcpcd.conf > /tmp/out && sudo mv /tmp/out /etc/dhcpcd.conf

sudo iw dev wlan0 interface add vwlan0 type master

#TODO: Generate random MAC address
sudo ip link set dev vwlan0 address 12:34:56:78:90:12

#Turn on new vwlan
sudo ip link set dev vwlan0 up
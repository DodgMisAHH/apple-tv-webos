// Generic preview inventory. sync-apps.py / tv/sync.js replace apps.js with your TV's inventory.
window.TV_APPS = {
  apps: [
    {id: 'io.strem.tv', title: 'Stremio', icon: 'marks/stremio.svg', iconColor: '#6552d9'},
    {id: 'netflix', title: 'Netflix', icon: 'marks/netflix-color.svg', iconColor: '#151515'},
    {id: 'com.disney.disneyplus-prod', title: 'Disney+', icon: 'marks/disneyplus.svg', iconColor: '#163c8d'},
    {id: 'youtube.leanback.v4', title: 'YouTube', icon: 'marks/youtube-color.svg', iconColor: '#ffffff'},
    {id: 'com.apple.appletv', title: 'Apple TV', icon: 'marks/appletv.svg', iconColor: '#151515'},
    {id: 'amazon', title: 'Prime Video', icon: 'marks/primevideo.svg', iconColor: '#0578ff'},
    {id: 'com.apple.applemusic', title: 'Apple Music', icon: 'marks/applemusic.svg', iconColor: '#fa233b'},
    {id: 'com.geforcenow.play', title: 'GeForce NOW', icon: 'marks/nvidia.svg', iconColor: '#76b900'},
    {id: 'com.webos.app.browser', title: 'Web Browser', icon: 'marks/browser.svg', iconColor: '#168bd2'},
    {id: 'com.webos.app.discovery', title: 'Apps', icon: 'marks/apps.svg', iconColor: '#4faa6e'}
  ],
  inputs: [
    {appId: 'com.webos.app.hdmi1', label: 'HDMI 1'},
    {appId: 'com.webos.app.hdmi2', label: 'HDMI 2'}
  ]
};

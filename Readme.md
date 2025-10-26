# Live Stream Child

- Mechanism explained in notes.txt

Note: This was originally a private repo. Most commits are not public, though I can walk you through them if you are curious.

[Screenshot](https://f.feednana.com/files/6fde7a4bcb514fe1801374f9c230a2a3.png)

[Screenshot](https://f.feednana.com/files/4a54b724934945208e9887bd63f441db.png)

### Requirements

- MongoDB
- NodeJS
- Puppeteer/Chromium

### Environment

CHILD_KEY => String, Authentication key used for communication between children
CLUSTER_COUNT => Number, Amount of "instance.js" instances that will be spawned
FILE_HOST => String, URL of the file host from which puppeteer will load scripts
MAIN_PORT => App will run on this port
MAX_STREAM_CONNECTIONS => Each instance will handle this number of clients including connections to other instances
MONGO_HOST
MONGO_PASSWORD
MONGO_USER
PEER_HOST => PeerJS host. Can use peer.carbonvalley.win for free
PEER_PORT => PeerJS port. Use 443 if using peer.carbonvalley.win
SOCKET_HOST => URL of main Filepimps server
SOCKET_KEY => Key used to authenticate with the main Filepimps server

### Instructions

- npm install
- Fill in the blanks in cluster.sh
- sh.cluster.sh

📘 Calc Duel

Minimalist competitive calculus duel (multiplayer + bot mode)
Built with Node.js + Express + Socket.io

Players solve calculus problems in real time.
First correct answer wins the round.
Lock early → spectate opponent live.

🚀 How To Run The Project
1️⃣ Install Required Software

Your friend must install:

✅ Node.js (LTS version)

Download from:
👉 https://nodejs.org/

After installing, verify:

node -v
npm -v


If both print versions → good.

2️⃣ Clone The Repository
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

3️⃣ Install Dependencies

Go into the server folder:

cd server
npm install


This installs:

express

socket.io

and all required packages

4️⃣ Start The Server

From inside /server:

node server.js


You should see:

Server on http://localhost:3000

5️⃣ Open The Game

Open browser:

http://localhost:3000


To test multiplayer:

Open two browser windows

Or one normal + one incognito

🌍 Playing With Someone Else (Different Country)

If testing remotely:

Use Cloudflare Tunnel:

cloudflared tunnel --url http://localhost:3000


Share the generated HTTPS link.

🧠 Project Structure
calc-game/
│
├── public/
│   ├── index.html
│   ├── script.js
│   └── style.css
│
├── server/
│   ├── server.js
│   ├── package.json
│   └── node_modules/
│
└── README.md

public/

Frontend:

UI

Scratchpad

Spectating

Game logic (client side)

server/

Backend:

Rooms

Multiplayer state

Question generation

Round handling

Spectate snapshots

🔄 Development Workflow
If changing frontend only:

Edit files in /public

Refresh browser

No server restart needed

If changing server logic:

Edit /server/server.js

Stop server (Ctrl + C)

Restart:

node server.js

🧪 How Spectating Works

When a player:

Locks answer

Enters spectate mode

Server sends scratchpad snapshot

Client renders opponent canvas

Important events:

draw:event

answer:lock

spectate:request

spectate:state

🛠 Recommended Tools

VS Code

Git

Chrome DevTools (for debugging sockets)

To see live socket events:

socket.onAny((event, ...args) => console.log(event, args));

🌱 Branch Strategy

new-main → stable branch

friend-work → experimental branch

Use pull requests to merge changes

To switch branches:

git checkout friend-work

⚠️ Common Issues
❌ “npm not recognized”

Reinstall Node.js and restart terminal.

❌ Port 3000 already in use

Kill previous server or change port in server.js.

❌ Spectating blank

Hard refresh both tabs (Ctrl + Shift + R).

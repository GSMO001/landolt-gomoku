const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function broadcastRooms() {
    const list = Array.from(rooms.values()).map(r => ({
        roomId: r.id, // ここをroomIdに統一
        count: r.players.length,
        hasPw: r.password !== "",
        status: r.gameStarted ? "対局中" : "待機中",
        timeLimit: r.settings.timeLimit
    }));
    io.emit("updateRoomList", list);
}

io.on("connection", (socket) => {
    broadcastRooms();

    // ルーム作成
    socket.on("createRoom", (data) => {
        const rid = data.roomId;
        if (!rid || rooms.has(rid)) return socket.emit("error_msg", "無効または重複したルーム名です");
        
        const room = {
            id: rid,
            password: data.password || "",
            settings: { timeLimit: data.timeLimit || "none" },
            players: [socket.id],
            board: [],
            turn: 0,
            gameStarted: false,
            pairCounts: [0, 0],
            timeLeft: data.timeLimit === "none" ? null : parseInt(data.timeLimit),
            timer: null
        };
        rooms.set(rid, room);
        socket.join(rid);
        socket.emit("roomJoined", { roomId: rid, playerIndex: 0, timeLimit: room.settings.timeLimit });
        broadcastRooms();
    });

    // ルーム参加 (ここを重点修正)
    socket.on("joinRoom", (data) => {
        const rid = data.roomId;
        const room = rooms.get(rid);

        if (!room) return socket.emit("error_msg", "ルームが見つかりません: " + rid);
        if (room.players.length >= 2) return socket.emit("error_msg", "満員です");
        if (room.password !== "" && room.password !== data.password) return socket.emit("error_msg", "パスワードが違います");

        room.players.push(socket.id);
        socket.join(rid);
        socket.emit("roomJoined", { roomId: rid, playerIndex: 1, timeLimit: room.settings.timeLimit });
        
        room.gameStarted = true;
        io.to(rid).emit("gameStart");
        if (room.settings.timeLimit !== "none") startTimer(rid);
        broadcastRooms();
    });

    function startTimer(rid) {
        const room = rooms.get(rid);
        if (!room || room.settings.timeLimit === "none") return;
        if (room.timer) clearInterval(room.timer);
        room.timeLeft = parseInt(room.settings.timeLimit);
        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(rid).emit("timerUpdate", { timeLeft: room.timeLeft });
            if (room.timeLeft <= 0) {
                clearInterval(room.timer);
                io.to(rid).emit("gameOver", { winner: 1 - room.turn, reason: "TIMEOUT" });
                rooms.delete(rid);
                broadcastRooms();
            }
        }, 1000);
    }

    socket.on("placePiece", (data) => {
        const room = rooms.get(data.roomId);
        if (!room || room.players[room.turn] !== socket.id) return;
        room.board.push(data.piece);
        room.pairCounts = data.consecutivePairs;
        room.turn = 1 - room.turn;
        if (room.settings.timeLimit !== "none") startTimer(data.roomId);
        io.to(data.roomId).emit("moveMade", { piece: data.piece, nextTurn: room.turn, consecutivePairs: room.pairCounts });
    });

    socket.on("disconnect", () => {
        for (const [id, room] of rooms) {
            if (room.players.includes(socket.id)) {
                if (room.timer) clearInterval(room.timer);
                io.to(id).emit("playerLeft");
                rooms.delete(id);
                broadcastRooms();
                break;
            }
        }
    });
});

server.listen(3000);

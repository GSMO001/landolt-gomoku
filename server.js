/**
 * LANDOLT GOMOKU ONLINE - PRO ENGINE
 * GitHub Ready: Full Room Sync & Security Logic
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000,
});

app.use(express.static(path.join(__dirname, "public")));

// ルームデータ管理
const rooms = new Map();

/**
 * 全クライアントに現在の全てのルーム情報をブロードキャストする
 */
function broadcastAllRooms() {
    const list = Array.from(rooms.values()).map(r => ({
        id: r.id,
        playerCount: r.players.length,
        hasPw: (r.password && r.password.length > 0),
        status: r.gameStarted ? "PLAYING" : (r.players.length >= 2 ? "FULL" : "OPEN"),
        timeLimit: r.settings.timeLimit
    }));
    io.emit("updateRoomList", list);
}

io.on("connection", (socket) => {
    // 接続時に全ルームを送信（以前作ったルームが表示されない問題を解決）
    socket.emit("updateRoomList", Array.from(rooms.values()).map(r => ({
        id: r.id, playerCount: r.players.length, hasPw: r.password !== "", status: r.gameStarted ? "PLAYING" : "OPEN", timeLimit: r.settings.timeLimit
    })));

    socket.on("createRoom", (data) => {
        const { roomId, password, settings } = data;
        if (!roomId || rooms.has(roomId)) return socket.emit("error_msg", "無効なルーム名または重複しています。");

        const room = {
            id: roomId,
            password: password || "",
            settings: settings,
            players: [socket.id],
            board: [],
            turn: 0,
            gameStarted: false,
            pairCounts: [0, 0],
            timer: null,
            timeLeft: settings.timeLimit === 'free' ? null : parseInt(settings.timeLimit)
        };

        rooms.set(roomId, room);
        socket.join(roomId);
        socket.emit("roomJoined", { roomId, playerIndex: 0 });
        broadcastAllRooms();
    });

    socket.on("joinRoom", (data) => {
        const { roomId, password } = data;
        const room = rooms.get(roomId);

        if (!room || room.players.length >= 2) return socket.emit("error_msg", "入室できません。");
        if (room.password !== "" && room.password !== password) return socket.emit("error_msg", "PWが違います。");

        room.players.push(socket.id);
        socket.join(roomId);
        socket.emit("roomJoined", { roomId, playerIndex: 1 });

        room.gameStarted = true;
        io.to(roomId).emit("gameStart");
        broadcastAllRooms();
        startRoomTimer(roomId);
    });

    socket.on("placePiece", (data) => {
        const { roomId, piece, consecutivePairs } = data;
        const room = rooms.get(roomId);
        if (!room || !room.gameStarted || room.players[room.turn] !== socket.id) return;

        room.board.push(piece);
        room.pairCounts = consecutivePairs;
        room.turn = 1 - room.turn;

        io.to(roomId).emit("moveMade", {
            piece,
            nextTurn: room.turn,
            consecutivePairs: room.pairCounts
        });
        startRoomTimer(roomId);
    });

    socket.on("declareWin", (data) => {
        const room = rooms.get(data.roomId);
        if (room) {
            stopRoomTimer(room);
            room.gameStarted = false;
            io.to(data.roomId).emit("gameOver", { winner: data.winner, reason: "checkmate" });
        }
    });

    function startRoomTimer(rid) {
        const room = rooms.get(rid);
        if (!room || room.settings.timeLimit === 'free') return;
        stopRoomTimer(room);
        room.timeLeft = parseInt(room.settings.timeLimit);
        io.to(rid).emit("timerUpdate", room.timeLeft);
        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(rid).emit("timerUpdate", room.timeLeft);
            if (room.timeLeft <= 0) {
                stopRoomTimer(room);
                room.gameStarted = false;
                io.to(rid).emit("gameOver", { winner: 1 - room.turn, reason: "timeout" });
            }
        }, 1000);
    }

    function stopRoomTimer(room) {
        if (room.timer) { clearInterval(room.timer); room.timer = null; }
    }

    socket.on("disconnect", () => {
        for (const [id, room] of rooms) {
            if (room.players.includes(socket.id)) {
                stopRoomTimer(room);
                io.to(id).emit("playerLeft");
                rooms.delete(id);
                broadcastAllRooms();
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));









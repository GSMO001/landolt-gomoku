/**
 * LANDOLT GOMOKU ONLINE - PROFESSIONAL SERVER ENGINE
 * 行数とロジックの密度を上げ、商用レベルの安定性を目指した構成
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingTimeout: 60000,
    pingInterval: 25000,
    connectionStateRecovery: {}, // 瞬断リカバリ有効化
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, "public")));

// メモリ内データベース
const rooms = new Map();
const userToRoom = new Map(); // 切断リカバリ用

/**
 * 公開用ルームリスト生成（情報の秘匿と最適化）
 */
function getSanitizedRoomList() {
    return Array.from(rooms.values()).map(r => ({
        id: r.id,
        playerCount: r.players.length,
        hasPassword: (r.password && r.password.length > 0),
        status: r.gameStarted ? "PLAYING" : (r.players.length >= 2 ? "FULL" : "OPEN"),
        timeLimit: r.settings.timeLimit,
        createdAt: r.createdAt
    })).sort((a, b) => b.createdAt - a.createdAt);
}

function syncLobby() {
    io.emit("updateRoomList", getSanitizedRoomList());
}

io.on("connection", (socket) => {
    console.log(`[IO] New Connection: ${socket.id}`);
    socket.emit("updateRoomList", getSanitizedRoomList());

    // ルーム作成ロジック（詳細なバリデーション付）
    socket.on("createRoom", (data) => {
        try {
            const { roomId, password, settings } = data;
            const cleanId = roomId ? roomId.trim() : "";
            
            if (cleanId.length < 1 || cleanId.length > 20) {
                return socket.emit("error_msg", "ルーム名は1〜20文字で入力してください。");
            }
            if (rooms.has(cleanId)) {
                return socket.emit("error_msg", "そのルーム名は既に使用されています。");
            }

            const roomObj = {
                id: cleanId,
                password: password || "",
                settings: {
                    timeLimit: settings.timeLimit || "60",
                    boardSize: 128
                },
                players: [socket.id],
                board: [],
                turn: 0,
                timer: null,
                timeLeft: settings.timeLimit === 'free' ? null : parseInt(settings.timeLimit),
                gameStarted: false,
                pairCounts: [0, 0],
                createdAt: Date.now()
            };

            rooms.set(cleanId, roomObj);
            userToRoom.set(socket.id, cleanId);
            socket.join(cleanId);
            socket.emit("roomJoined", { roomId: cleanId, playerIndex: 0 });
            syncLobby();
        } catch (e) {
            socket.emit("error_msg", "ルーム作成に失敗しました。");
        }
    });

    // 入室ロジック（多重チェック）
    socket.on("joinRoom", (data) => {
        const { roomId, password } = data;
        const room = rooms.get(roomId);

        if (!room) return socket.emit("error_msg", "ルームが存在しません。");
        if (room.players.length >= 2) return socket.emit("error_msg", "満員です。");
        if (room.password !== "" && room.password !== password) {
            return socket.emit("error_msg", "パスワードが正しくありません。");
        }

        room.players.push(socket.id);
        userToRoom.set(socket.id, roomId);
        socket.join(roomId);
        socket.emit("roomJoined", { roomId, playerIndex: 1 });

        room.gameStarted = true;
        io.to(roomId).emit("gameStart");
        syncLobby();
        
        runTimer(roomId);
    });

    // 着手同期ロジック
    socket.on("placePiece", (data) => {
        const { roomId, piece, consecutivePairs } = data;
        const room = rooms.get(roomId);
        
        if (!room || !room.gameStarted) return;
        if (room.players[room.turn] !== socket.id) return;

        // サーバー側での簡易バリデーション
        if (piece.x < 0 || piece.x >= 128 || piece.y < 0 || piece.y >= 128) return;

        room.board.push(piece);
        room.pairCounts = consecutivePairs;
        room.turn = 1 - room.turn;

        io.to(roomId).emit("moveMade", {
            piece,
            nextTurn: room.turn,
            consecutivePairs: room.pairCounts
        });

        runTimer(roomId);
    });

    socket.on("declareWin", (data) => {
        const { roomId, winner } = data;
        const room = rooms.get(roomId);
        if (room) {
            clearRoomTimer(room);
            room.gameStarted = false;
            io.to(roomId).emit("gameOver", { winner, reason: "checkmate" });
        }
    });

    function clearRoomTimer(room) {
        if (room.timer) {
            clearInterval(room.timer);
            room.timer = null;
        }
    }

    function runTimer(rid) {
        const room = rooms.get(rid);
        if (!room || room.settings.timeLimit === 'free') return;
        
        clearRoomTimer(room);
        room.timeLeft = parseInt(room.settings.timeLimit);
        io.to(rid).emit("timerUpdate", room.timeLeft);

        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(rid).emit("timerUpdate", room.timeLeft);

            if (room.timeLeft <= 0) {
                clearRoomTimer(room);
                room.gameStarted = false;
                io.to(rid).emit("gameOver", { winner: 1 - room.turn, reason: "timeout" });
            }
        }, 1000);
    }

    socket.on("disconnect", () => {
        const roomId = userToRoom.get(socket.id);
        if (roomId) {
            const room = rooms.get(roomId);
            if (room) {
                clearRoomTimer(room);
                io.to(roomId).emit("playerLeft");
                rooms.delete(roomId);
                userToRoom.delete(socket.id);
                syncLobby();
            }
        }
        console.log(`[IO] Disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[LANDOLT-SERVER] Running on :${PORT}`));








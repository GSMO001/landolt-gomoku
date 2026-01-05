const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" } // 接続許可設定
});

app.use(express.static("public"));

// ルーム管理
const rooms = {};

// ターン切り替えとタイマー管理
function switchTurn(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    // 既存のタイマーをクリア
    if (room.timer) clearInterval(room.timer);

    room.turn = 1 - room.turn;

    // 時間制限設定を確認
    const limitSetting = room.settings.timeLimit; // "10", "20", "30", "free"

    // "free" の場合はタイマーを作動させない
    if (limitSetting === 'free') {
        io.to(roomId).emit("timerUpdate", "∞"); // 無限マークを送る
        return;
    }

    // 数値に変換してタイマーセット
    room.timeLeft = parseInt(limitSetting, 10);

    // 初回表示用
    io.to(roomId).emit("timerUpdate", room.timeLeft);

    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(roomId).emit("timerUpdate", room.timeLeft);

        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            const winner = 1 - room.turn; // 時間切れした人の負け
            room.gameState = "finished";
            io.to(roomId).emit("gameOver", { winner: winner, reason: "timeout" });
        }
    }, 1000);
}

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // ルーム作成
    socket.on("createRoom", ({ roomId, password, settings }) => {
        if (rooms[roomId]) {
            socket.emit("error", "そのルームIDは既に存在します");
            return;
        }
        
        // 設定のデフォルト値など
        const initialTime = settings.timeLimit === 'free' ? "∞" : parseInt(settings.timeLimit, 10);

        rooms[roomId] = {
            id: roomId,
            password: password,
            players: [socket.id],
            board: [],
            turn: 0,
            timer: null,
            timeLeft: initialTime,
            settings: settings,
            gameState: "waiting",
            consecutivePairs: [0, 0],
            lastOpponentPiece: null,
            reviewStep: 0,
            history: []
        };

        socket.join(roomId);
        socket.emit("roomJoined", { roomId, playerIndex: 0, settings });
    });

    // ルーム参加
    socket.on("joinRoom", ({ roomId, password }) => {
        const room = rooms[roomId];

        if (!room) {
            socket.emit("error", "ルームが見つかりません");
            return;
        }
        if (room.players.length >= 2) {
            socket.emit("error", "ルームは満員です");
            return;
        }
        if (room.password && room.password !== password) {
            socket.emit("error", "パスワードが間違っています");
            return;
        }

        room.players.push(socket.id);
        socket.join(roomId);
        
        room.gameState = "playing";
        io.to(roomId).emit("gameStart", { 
            roomId, 
            players: room.players,
            settings: room.settings
        });
        
        // ゲーム開始：先手のタイマーセット
        // switchTurnはターンを反転させるので、一度 turn=1 にして呼び出すことで 0(先手) に戻す
        room.turn = 1; 
        switchTurn(roomId);
    });

    socket.on("placePiece", ({ roomId, piece }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== "playing") return;
        
        const playerIndex = room.players.indexOf(socket.id);
        if (playerIndex !== room.turn) return;

        room.board.push(piece);
        
        room.history.push({
            piece: piece,
            consecutivePairs: [...room.consecutivePairs],
            moveNumber: room.history.length + 1
        });
        
        io.to(roomId).emit("moveMade", { 
            piece, 
            nextTurn: 1 - room.turn 
        });

        // 次のターンへ
        switchTurn(roomId);
    });

    socket.on("declareWin", ({ roomId, winner }) => {
        const room = rooms[roomId];
        if(room) {
            if (room.timer) clearInterval(room.timer);
            room.gameState = "finished";
            io.to(roomId).emit("gameOver", { winner, reason: "checkmate" });
        }
    });

    socket.on("syncReview", ({ roomId, step }) => {
        const room = rooms[roomId];
        if (room && room.settings.syncReview) {
            room.reviewStep = step;
            socket.to(roomId).emit("reviewStateUpdated", step);
        }
    });

    socket.on("leaveRoom", ({ roomId }) => {
        handleDisconnect(socket, roomId);
    });

    socket.on("disconnect", () => {
        for (const rId in rooms) {
            if (rooms[rId].players.includes(socket.id)) {
                handleDisconnect(socket, rId);
            }
        }
    });
});

function handleDisconnect(socket, roomId) {
    const room = rooms[roomId];
    if (!room) return;

    if (room.timer) clearInterval(room.timer);
    io.to(roomId).emit("playerLeft");
    delete rooms[roomId];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
/**
 * ランドルト環五目並べ ONLINE - Client Side Logic (Full Version)
 */
const socket = io();
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');

// --- 1. システム定数・変数 ---
const BOARD_CELLS = 128;
const BASE_SIZE = 40;

let lobbyList = [];
let myRoom = "";
let mySide = null;      // 0:黒(Black), 1:白(White)
let boardPieces = [];   // 現在の盤面
let moveHistory = [];   // 感想戦用の全履歴
let activeTurn = 0;     // 0 or 1. -1は通信中のロック
let pairCounts = [0, 0];

// カメラ・ズーム制御
let centerX = 64, centerY = 64; // 盤面の中心座標
let zoomLevel = 1.0;
let selDir = 0;         // 選択中のランドルト環の向き (0:上, 1:右, 2:下, 3:左)
let isGameRunning = false;
let reviewMode = false;
let reviewPointer = 0;

// --- 2. タッチ・マウス操作用変数 ---
let lastX = 0, lastY = 0;
let dragActive = false;
let startPinchDist = 0;
let touchMoved = false; // 動いた場合はクリック（着手）とみなさない

// --- 3. ロビー関連の通信 ---
socket.on('updateRoomList', (list) => {
    lobbyList = list;
    updateLobby();
});

function updateLobby() {
    const area = document.getElementById('roomListArea');
    const query = document.getElementById('searchInput').value.toLowerCase();
    area.innerHTML = "";

    const results = lobbyList.filter(r => r.id.toLowerCase().includes(query));
    if (results.length === 0) {
        area.innerHTML = `<p style="text-align:center; color:#94a3b8; margin-top:30px;">該当するルームはありません</p>`;
        return;
    }

    results.forEach(room => {
        const entry = document.createElement('div');
        entry.className = "room-entry";
        entry.innerHTML = `
            <div class="room-info-box">
                <b>${room.id} ${room.hasPassword ? '🔒' : ''}</b>
                <p>${room.status} (${room.playerCount}/2人) | ${room.timeLimit === 'free' ? '無制限' : room.timeLimit + 's'}</p>
            </div>
            <button class="btn-join" ${room.playerCount >= 2 ? 'disabled' : ''} onclick="doJoin('${room.id}', ${room.hasPassword})">参戦</button>
        `;
        area.appendChild(entry);
    });
}

function reqCreate() {
    const id = document.getElementById('createId').value;
    const pw = document.getElementById('createPw').value;
    const limit = document.getElementById('createLimit').value;
    if (!id) return alert("名前を入力してください");
    socket.emit('createRoom', { roomId: id, password: pw, settings: { timeLimit: limit } });
}

function doJoin(id, hasPw) {
    let pass = hasPw ? prompt("パスワードを入力:") : "";
    if (pass !== null) socket.emit('joinRoom', { roomId: id, password: pass });
}

// --- 4. ゲーム開始・同期 ---
socket.on('roomJoined', (data) => {
    myRoom = data.roomId;
    mySide = data.playerIndex;
    document.getElementById('lobbyScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'flex';
    document.getElementById('roomNameLabel').textContent = myRoom;
    onResize();
    focusPoint(64, 64);
});

socket.on('gameStart', () => {
    isGameRunning = true;
    updateGameUI();
    drawBoard();
});

// 手番の同期（ここで activeTurn を更新してロックを解除する）
socket.on('moveMade', (data) => {
    const p = data.piece;
    boardPieces.push(p);
    moveHistory.push({...p});
    
    // 【重要】サーバーから届いた次の手番をセット（ロック解除）
    activeTurn = data.nextTurn; 
    pairCounts = data.consecutivePairs;

    // 相手が置いた場合はカメラをそこへ飛ばす
    if (p.player !== mySide) focusPoint(p.x, p.y);
    
    updateGameUI();
    drawBoard();
});

socket.on('timerUpdate', t => {
    document.getElementById('timeText').textContent = t + "s";
});

socket.on('gameOver', (data) => {
    isGameRunning = false;
    const modal = document.getElementById('gameEndModal');
    document.getElementById('endResultTitle').textContent = data.winner === mySide ? "勝利！" : (data.winner === -1 ? "引き分け" : "敗北...");
    document.getElementById('endResultDesc').textContent = data.reason === "timeout" ? "時間切れです。" : "五目並び（対込み）成立。";
    modal.classList.add('active');
});

socket.on('playerLeft', () => {
    alert("相手が退出しました。");
    location.reload();
});

socket.on('error_msg', m => alert(m));

// --- 5. 描画ロジック ---
function focusPoint(x, y) { centerX = x; centerY = y; }

function drawBoard() {
    if (!canvas.width) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sz = BASE_SIZE * zoomLevel;
    const offX = canvas.width / 2 - centerX * sz;
    const offY = canvas.height / 2 - centerY * sz;

    // 盤面背景（深緑）
    ctx.fillStyle = "#14532d"; 
    ctx.fillRect(offX, offY, BOARD_CELLS * sz, BOARD_CELLS * sz);

    // グリッド線
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= BOARD_CELLS; i++) {
        ctx.moveTo(offX + i * sz, offY);
        ctx.lineTo(offX + i * sz, offY + BOARD_CELLS * sz);
        ctx.moveTo(offX, offY + i * sz);
        ctx.lineTo(offX + BOARD_CELLS * sz, offY + i * sz);
    }
    ctx.stroke();

    const currentList = reviewMode ? moveHistory.slice(0, reviewPointer) : boardPieces;

    // 「対」の点線描画
    currentList.forEach((p1, idx) => {
        for (let j = idx + 1; j < currentList.length; j++) {
            const p2 = currentList[j];
            if (p1.player === p2.player && checkFacing(p1, p2)) {
                ctx.beginPath();
                ctx.setLineDash([6, 4]);
                ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
                ctx.lineWidth = Math.max(2, sz * 0.08);
                ctx.moveTo(offX + p1.x * sz + sz/2, offY + p1.y * sz + sz/2);
                ctx.lineTo(offX + p2.x * sz + sz/2, offY + p2.y * sz + sz/2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    });

    // 駒（ランドルト環）の描画
    currentList.forEach((p) => {
        const px = offX + p.x * sz + sz / 2;
        const py = offY + p.y * sz + sz / 2;

        if (px < -sz || px > canvas.width + sz || py < -sz || py > canvas.height + sz) return;

        // 円体
        ctx.beginPath();
        ctx.arc(px, py, sz * 0.35, 0, Math.PI * 2);
        ctx.strokeStyle = (p.player === 0) ? "#000" : "#fff";
        ctx.lineWidth = sz * 0.12;
        ctx.stroke();

        // 切れ目（金色）
        ctx.beginPath();
        const rads = [-Math.PI/2, 0, Math.PI/2, Math.PI];
        const sA = rads[p.direction] - 0.45;
        const eA = rads[p.direction] + 0.45;
        ctx.arc(px, py, sz * 0.35, sA, eA);
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = sz * 0.14;
        ctx.stroke();
    });
}

function checkFacing(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
    if (dx === 0 && dy === -1) return p1.direction === 0 && p2.direction === 2;
    if (dx === 1 && dy === 0) return p1.direction === 1 && p2.direction === 3;
    if (dx === 0 && dy === 1) return p1.direction === 2 && p2.direction === 0;
    if (dx === -1 && dy === 0) return p1.direction === 3 && p2.direction === 1;
    return false;
}

// --- 6. タッチ・マウスイベント制御 ---
// タッチ開始
canvas.addEventListener('touchstart', (e) => {
    touchMoved = false;
    if (e.touches.length === 1) {
        dragActive = true;
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
        dragActive = false;
        startPinchDist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
    }
}, { passive: false });

// タッチ移動
canvas.addEventListener('touchmove', (e) => {
    e.preventDefault(); 
    if (e.touches.length === 1 && dragActive) {
        const dx = (e.touches[0].clientX - lastX);
        const dy = (e.touches[0].clientY - lastY);
        // しきい値：8px以上動いたら「移動」とみなす
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) touchMoved = true;
        centerX -= dx / (BASE_SIZE * zoomLevel);
        centerY -= dy / (BASE_SIZE * zoomLevel);
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
        drawBoard();
    } else if (e.touches.length === 2) {
        touchMoved = true;
        const dist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        const ratio = dist / startPinchDist;
        zoomLevel = Math.max(0.4, Math.min(zoomLevel * ratio, 4.0));
        startPinchDist = dist;
        drawBoard();
    }
}, { passive: false });

// タッチ終了
canvas.addEventListener('touchend', (e) => {
    if (!touchMoved && e.changedTouches.length === 1) {
        const rect = canvas.getBoundingClientRect();
        const t = e.changedTouches[0];
        processClick(t.clientX - rect.left, t.clientY - rect.top);
    }
    dragActive = false;
});

// PC用マウス操作
canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) { dragActive = true; touchMoved = false; }
    lastX = e.clientX; lastY = e.clientY;
});
window.addEventListener('mousemove', (e) => {
    if (dragActive) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) touchMoved = true;
        centerX -= dx / (BASE_SIZE * zoomLevel);
        centerY -= dy / (BASE_SIZE * zoomLevel);
        lastX = e.clientX; lastY = e.clientY;
        drawBoard();
    }
});
window.addEventListener('mouseup', () => dragActive = false);
canvas.addEventListener('click', (e) => {
    if (!touchMoved) {
        const rect = canvas.getBoundingClientRect();
        processClick(e.clientX - rect.left, e.clientY - rect.top);
    }
});
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoomLevel = Math.max(0.4, Math.min(zoomLevel * delta, 4.0));
    drawBoard();
}, { passive: false });

// --- 7. ゲームアクション ---
function processClick(sx, sy) {
    // 手番チェック (activeTurnがmySideと一致しない、または-1(ロック中)なら無視)
    if (!isGameRunning || activeTurn !== mySide || reviewMode) return;

    const sz = BASE_SIZE * zoomLevel;
    const offX = canvas.width / 2 - centerX * sz;
    const offY = canvas.height / 2 - centerY * sz;

    const gx = Math.floor((sx - offX) / sz);
    const gy = Math.floor((sy - offY) / sz);

    // 範囲外・既存駒チェック
    if (gx < 0 || gx >= BOARD_CELLS || gy < 0 || gy >= BOARD_CELLS) return;
    if (boardPieces.find(p => p.x === gx && p.y === gy)) return;

    // 「対」の判定
    let isPairAction = false;
    const lastOpp = boardPieces.filter(p => p.player !== mySide).slice(-1)[0];
    if (lastOpp) {
        const dx = gx - lastOpp.x;
        const dy = gy - lastOpp.y;
        if ((lastOpp.direction === 0 && dy === -1) || (lastOpp.direction === 1 && dx === 1) ||
            (lastOpp.direction === 2 && dy === 1) || (lastOpp.direction === 3 && dx === -1)) {
            isPairAction = true;
        }
    }

    if (isPairAction && pairCounts[mySide] >= 3) {
        alert("「対」は3連続までです。");
        return;
    }

    const nextPairs = [...pairCounts];
    nextPairs[mySide] = isPairAction ? nextPairs[mySide] + 1 : 0;
    
    // 【重要】一時ロックをかける
    activeTurn = -1; 
    
    const newPiece = { x: gx, y: gy, direction: selDir, player: mySide };
    socket.emit('placePiece', { roomId: myRoom, piece: newPiece, consecutivePairs: nextPairs });

    // 勝利判定
    if (validateWin(boardPieces.concat(newPiece), mySide)) {
        socket.emit('declareWin', { roomId: myRoom, winner: mySide });
    }
}

function validateWin(all, side) {
    const mine = all.filter(p => p.player === side);
    const vectors = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (let p of mine) {
        for (let [vx, vy] of vectors) {
            let chain = [p];
            for (let i = 1; i < 5; i++) {
                const match = mine.find(t => t.x === p.x + vx * i && t.y === p.y + vy * i);
                if (match) chain.push(match); else break;
            }
            if (chain.length >= 5) {
                for (let c1 of chain) {
                    for (let c2 of mine) {
                        if (c1 !== c2 && checkFacing(c1, c2)) return true;
                    }
                }
            }
        }
    }
    return false;
}

// --- 8. UI・感想戦 ---
function updateGameUI() {
    const lbl = document.getElementById('gameStatusLabel');
    if (!isGameRunning) return;
    const colorName = activeTurn === 0 ? "黒" : "白";
    lbl.textContent = (activeTurn === mySide) ? `★ あなたの番 (${colorName})` : `相手が思考中... (${colorName})`;
    lbl.style.color = (activeTurn === mySide) ? "#3b82f6" : "#64748b";
    document.getElementById('pairStatLabel').textContent = `連続対: 黒${pairCounts[0]}/3 白${pairCounts[1]}/3`;
}

function startReview() {
    document.getElementById('gameEndModal').classList.remove('active');
    reviewMode = true;
    reviewPointer = moveHistory.length;
    document.getElementById('reviewBar').style.display = 'block';
    document.getElementById('dirSelectorArea').style.display = 'none';
    refreshReview();
    drawBoard();
}

function stepReview(d) {
    reviewPointer = Math.max(0, Math.min(moveHistory.length, reviewPointer + d));
    if (reviewPointer > 0) {
        const p = moveHistory[reviewPointer - 1];
        focusPoint(p.x, p.y);
    }
    refreshReview();
    drawBoard();
}

function refreshReview() {
    document.getElementById('reviewStepLabel').textContent = `${reviewPointer} / ${moveHistory.length}`;
}

function updateSelDir(d) {
    selDir = d;
    document.querySelectorAll('.dir-choice').forEach((b, i) => b.classList.toggle('selected', i === d));
}

function onResize() {
    const area = document.getElementById('gameCanvasArea');
    canvas.width = area.clientWidth;
    canvas.height = area.clientHeight;
    drawBoard();
}
window.addEventListener('resize', onResize);





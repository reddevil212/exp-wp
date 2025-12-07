const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

let client;
let isClientReady = false;
const sentMessages = new Map(); // Store sent messages for deletion

// Helper delay function
function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

function startClient() {
    console.log('Initializing WhatsApp Client...');

    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', (qr) => {
        console.log('QR Received');
        io.emit('qr', qr);
        io.emit('status', 'qr_ready');
    });

    client.on('ready', () => {
        console.log('Client is ready!');
        isClientReady = true;
        io.emit('status', 'ready');
        io.emit('log', 'WhatsApp Client is Ready!');
    });

    client.on('authenticated', () => {
        console.log('Authenticated');
        io.emit('status', 'authenticated');
        io.emit('log', 'Authenticated successfully.');
    });

    client.on('auth_failure', (msg) => {
        console.error('AUTHENTICATION FAILURE', msg);
        io.emit('status', 'error');
        io.emit('log', 'Authentication Failed: ' + msg);
    });

    client.on('disconnected', async (reason) => {
        console.log('Client was logged out', reason);
        isClientReady = false;
        io.emit('status', 'disconnected');
        io.emit('log', 'Client disconnected: ' + reason);

        // Destroy and re-initialize
        try {
            await client.destroy();
        } catch (error) {
            console.error('Error destroying client:', error);
        }

        // Small delay before restarting to ensure cleanup
        setTimeout(() => {
            startClient();
        }, 1000);
    });

    client.initialize();
}

// Try deleting message
async function tryDeleteMessage(sentMessage, chatId) {
    try {
        if (!sentMessage) return;

        if (typeof sentMessage.delete === 'function') {
            await sentMessage.delete(true);
            console.log(`Deleted via message.delete in ${chatId}`);
            return;
        }

        if (typeof client.deleteMessage === 'function') {
            const msgId = sentMessage.id?._serialized
                || sentMessage._data?.id?.id
                || (sentMessage.id && sentMessage.id.id);

            if (!msgId) {
                console.warn('Could not extract message ID for deletion', chatId);
                return;
            }

            await client.deleteMessage(chatId, msgId, true);
            console.log(`Deleted via client.deleteMessage in ${chatId}`);
            return;
        }

        console.warn('Delete not supported by this version');
    } catch (err) {
        console.error(`Delete failed in ${chatId}:`, err.message || err);
    }
}

// Delete last N
async function deleteLastMessages(chatId, n, socket) {
    const arr = sentMessages.get(chatId) || [];
    if (!arr.length) {
        if (socket) socket.emit('log', `No sent messages stored for ${chatId}`);
        return;
    }
    const toDelete = arr.splice(-n);
    sentMessages.set(chatId, arr);

    if (socket) socket.emit('log', `Deleting ${toDelete.length} messages for ${chatId}...`);

    for (const msg of toDelete) {
        await tryDeleteMessage(msg, chatId);
        await delay(400);
    }

    if (socket) socket.emit('log', `Deletion complete for ${chatId}`);
}

// Helper function to perform the spamming logic
async function performSpam(data, socket) {
    const { numbers, message, rows, cols, count, delayTime, mode } = data;

    if (!isClientReady || !client) {
        if (socket) socket.emit('log', 'Error: Client not ready. Cannot send scheduled message.');
        return;
    }

    const targetNumbers = numbers.split(',').map(n => n.trim()).filter(n => n);
    const gridRows = parseInt(rows) || 50;
    const gridCols = parseInt(cols) || 2;
    const sendCount = parseInt(count) || 1;
    const waitTime = parseInt(delayTime) || 300;
    const isGrid = mode === 'grid';

    // Generate Message
    let finalMessage = message;
    if (isGrid) {
        finalMessage = "";
        for (let r = 0; r < gridRows; r++) {
            let line = "";
            for (let c = 0; c < gridCols; c++) {
                line += message + " ";
            }
            finalMessage += line.trim() + "\n";
        }
        finalMessage = finalMessage.trim();
    }

    if (socket) socket.emit('log', `Starting ${isGrid ? 'GRID' : 'NORMAL'} spam process for ${targetNumbers.length} numbers...`);

    for (const numberRaw of targetNumbers) {
        let number = numberRaw;
        if (!number.includes('@c.us')) {
            number = `${number}@c.us`;
        }

        if (!sentMessages.has(number)) sentMessages.set(number, []);

        if (socket) socket.emit('log', `Targeting: ${number}`);

        for (let i = 1; i <= sendCount; i++) {
            try {
                const sent = await client.sendMessage(number, finalMessage);
                sentMessages.get(number).push(sent);
                if (socket) socket.emit('log', `✅ Sent message #${i} to ${number}`);
            } catch (err) {
                if (socket) socket.emit('log', `❌ Failed #${i} to ${number}: ${err.message}`);
            }
            await delay(waitTime);
        }
    }
    if (socket) socket.emit('log', '🎉 All messages processed.');
}

// Socket.io Connection
io.on('connection', (socket) => {
    console.log('New client connected');

    // Send current status
    if (isClientReady) {
        socket.emit('status', 'ready');
    } else {
        socket.emit('status', 'authenticating');
    }

    // Handle Start Spamming (Immediate)
    socket.on('start_spam', async (data) => {
        if (!isClientReady || !client) {
            socket.emit('log', 'Error: Client not ready. Please scan QR code first.');
            return;
        }

        // Validation
        if (!data.numbers || !data.message) {
            socket.emit('log', 'Error: Missing numbers or message.');
            return;
        }

        await performSpam(data, socket);
    });

    // Handle Scheduled Spamming
    socket.on('schedule_spam', (data) => {
        if (!isClientReady || !client) {
            socket.emit('log', 'Error: Client not ready. Please scan QR code first.');
            return;
        }

        const { scheduledTime } = data;
        if (!scheduledTime) {
            socket.emit('log', 'Error: No schedule time provided.');
            return;
        }

        const targetTime = new Date(scheduledTime).getTime();
        const now = Date.now();
        const delayMs = targetTime - now;

        if (delayMs <= 0) {
            socket.emit('log', 'Error: Scheduled time must be in the future.');
            return;
        }

        socket.emit('log', `📅 Message scheduled for ${new Date(targetTime).toLocaleString()}`);

        setTimeout(() => {
            console.log('Executing scheduled task...');
            if (socket) socket.emit('log', '⏰ Executing scheduled message now...');
            performSpam(data, socket);
        }, delayMs);
    });

    // Handle Delete Messages
    socket.on('delete_messages', async (data) => {
        if (!isClientReady || !client) {
            socket.emit('log', 'Error: Client not ready.');
            return;
        }

        const { numbers, count } = data;
        const targetNumbers = numbers.split(',').map(n => n.trim()).filter(n => n);
        const deleteCount = parseInt(count) || 1;

        for (const numberRaw of targetNumbers) {
            let number = numberRaw;
            if (!number.includes('@c.us')) {
                number = `${number}@c.us`;
            }
            await deleteLastMessages(number, deleteCount, socket);
        }
    });

    socket.on('logout', async () => {
        try {
            console.log('Logout requested');
            if (client) {
                // Try to logout gracefully
                try {
                    await client.logout();
                } catch (err) {
                    console.warn('Graceful logout failed, forcing destroy', err.message);
                }

                try {
                    await client.destroy();
                } catch (err) {
                    console.warn('Destroy failed', err.message);
                }
            }

            // Force delete auth folder to ensure new QR
            const authPath = path.join(__dirname, '.wwebjs_auth');
            if (fs.existsSync(authPath)) {
                console.log('Deleting auth session...');
                fs.rmSync(authPath, { recursive: true, force: true });
            }

            socket.emit('log', 'Logged out. Restarting client...');
            socket.emit('status', 'disconnected');

            // Restart client
            isClientReady = false;
            setTimeout(() => {
                startClient();
            }, 2000);

        } catch (e) {
            console.error('Logout error:', e);
            socket.emit('log', 'Logout failed: ' + e.message);
        }
    });
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startClient();
});

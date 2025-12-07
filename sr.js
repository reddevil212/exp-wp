const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const readline = require('readline');

// Contacts to message
const phoneNumbers = [
    '918145517446@c.us'
];

// Adjustable grid message settings
let rows = 50;                 
let cols = 2;                 
let baseMessage = "Love You Re❤️😘 "; 

// How many grid messages to send per contact
const SEND_COUNT = 1;

const AUTO_DELETE_LAST_N = 0;
const DELETE_AFTER_SECONDS = 10;

const client = new Client({ authStrategy: new LocalAuth() });
const sentMessages = new Map();

function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

// Generate the final multi-line message using rows × cols
function generateGridMessage() {
    let final = "";
    for (let r = 0; r < rows; r++) {
        let line = "";
        for (let c = 0; c < cols; c++) {
            line += baseMessage + " ";
        }
        final += line.trim() + "\n";
    }
    return final.trim();
}

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('Scan the QR code with WhatsApp!');
});
client.on('authenticated', () => console.log('Authenticated'));
client.on('auth_failure', err => console.error('Auth failure', err));
client.on('disconnected', () => console.log('Client disconnected'));

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
async function deleteLastMessages(chatId, n) {
    const arr = sentMessages.get(chatId) || [];
    if (!arr.length) {
        console.log(`No sent messages stored for ${chatId}`);
        return;
    }
    const toDelete = arr.splice(-n);
    sentMessages.set(chatId, arr);

    for (const msg of toDelete) {
        await tryDeleteMessage(msg, chatId);
        await delay(400);
    }

    console.log(`Attempted delete of ${toDelete.length} messages in ${chatId}`);
}

// Send the grid messages
async function sendMessage() {
    const gridMsg = generateGridMessage();

    for (const number of phoneNumbers) {
        if (!sentMessages.has(number)) sentMessages.set(number, []);

        for (let i = 1; i <= SEND_COUNT; i++) {
            try {
                const sent = await client.sendMessage(number, gridMsg);
                sentMessages.get(number).push(sent);
                console.log(`Grid message #${i} sent to ${number}`);
            } catch (err) {
                console.error(`Failed to send #${i} to ${number}:`, err.message || err);
            }

            await delay(300);
        }

        if (AUTO_DELETE_LAST_N > 0) {
            setTimeout(() => deleteLastMessages(number, AUTO_DELETE_LAST_N), DELETE_AFTER_SECONDS * 1000);
        }
    }
}

client.on('ready', () => {
    console.log('Client ready! Press "s" to send grid messages.');

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    process.stdin.on('keypress', async (str, key) => {
        if (key && key.ctrl && key.name === 'c') process.exit();

        if (!str) return;

        const ch = str.toLowerCase();

        if (ch === 's') {
            console.log('Sending grid messages...');
            await sendMessage();
        } else if (ch === 'r') {
            console.log('Resending...');
            await sendMessage();
        }
    });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    console.log("Commands: 's' send, 'r' resend, 'd N' delete last N, 'exit' to quit");

    rl.on('line', async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        const parts = trimmed.split(/\s+/);
        const cmd = parts[0].toLowerCase();

        if (cmd === 'd') {
            const n = parseInt(parts[1], 10);
            if (isNaN(n) || n <= 0) return console.log("Usage: d N");

            console.log(`Deleting last ${n} messages...`);
            for (const number of phoneNumbers) await deleteLastMessages(number, n);
        }
        else if (cmd === 'exit' || cmd === 'quit') {
            process.exit();
        }
        else if (cmd === 'r') {
            console.log("Resending grid messages...");
            await sendMessage();
        }
        else {
            console.log("Unknown command.");
        }
    });
});

client.initialize();

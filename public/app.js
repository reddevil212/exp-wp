const socket = io();

const statusBadge = document.getElementById('status-badge');
const qrSection = document.getElementById('qr-section');
const controlPanel = document.getElementById('control-panel');
const logsDiv = document.getElementById('logs');
const qrCodeDiv = document.getElementById('qrcode');
const loadingText = document.getElementById('loading-text');

let qrCodeObj = null;

// Initialize Flatpickr
flatpickr("#schedule-time", {
    enableTime: true,
    dateFormat: "Y-m-d H:i",
    minDate: "today",
    theme: "dark"
});

function toggleMode() {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const gridSettings = document.getElementById('grid-settings');
    if (mode === 'grid') {
        gridSettings.style.display = 'flex';
    } else {
        gridSettings.style.display = 'none';
    }
}

function updateStatus(status) {
    statusBadge.className = 'badge ' + status;

    if (status === 'ready' || status === 'authenticated') {
        statusBadge.textContent = 'Connected';
        statusBadge.classList.add('connected');
        qrSection.style.display = 'none';
        controlPanel.classList.remove('disabled');
    } else if (status === 'qr_ready') {
        statusBadge.textContent = 'Scan QR';
        statusBadge.classList.add('authenticating');
        qrSection.style.display = 'block';
        controlPanel.classList.add('disabled');
    } else {
        statusBadge.textContent = 'Disconnected';
        statusBadge.classList.add('disconnected');
        qrSection.style.display = 'block';
        controlPanel.classList.add('disabled');
    }
}

function addLog(message) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logsDiv.appendChild(entry);
    logsDiv.scrollTop = logsDiv.scrollHeight;
}

socket.on('connect', () => {
    addLog('Connected to server.');
});

socket.on('status', (status) => {
    console.log('Status:', status);
    updateStatus(status);
});

socket.on('qr', (qr) => {
    addLog('QR Code received. Please scan.');
    qrCodeDiv.innerHTML = ''; // Clear previous
    new QRCode(qrCodeDiv, {
        text: qr,
        width: 256,
        height: 256
    });
    loadingText.style.display = 'none';
});

socket.on('log', (msg) => {
    addLog(msg);
});

function getFormData() {
    const numbers = document.getElementById('numbers').value;
    const message = document.getElementById('message').value;
    const rows = document.getElementById('rows').value;
    const cols = document.getElementById('cols').value;
    const count = document.getElementById('count').value;
    const delayTime = document.getElementById('delay').value;
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const scheduledTime = document.getElementById('schedule-time').value;

    return { numbers, message, rows, cols, count, delayTime, mode, scheduledTime };
}

function startSpam() {
    const data = getFormData();
    if (!data.numbers || !data.message) {
        alert('Please enter phone numbers and a message.');
        return;
    }
    socket.emit('start_spam', data);
}

function scheduleSpam() {
    const data = getFormData();
    if (!data.numbers || !data.message) {
        alert('Please enter phone numbers and a message.');
        return;
    }
    if (!data.scheduledTime) {
        alert('Please select a time for scheduling.');
        return;
    }
    socket.emit('schedule_spam', data);
}

function deleteMessages() {
    const count = document.getElementById('delete-count').value;
    const numbers = document.getElementById('numbers').value;

    if (!numbers) {
        alert('Please enter phone numbers to delete messages from.');
        return;
    }

    if (confirm(`Delete last ${count} messages for entered numbers?`)) {
        socket.emit('delete_messages', { numbers, count });
    }
}

function logout() {
    if (confirm('Are you sure you want to logout?')) {
        socket.emit('logout');
        // location.reload();
    }
}

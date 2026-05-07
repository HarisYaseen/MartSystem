function showToast(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'check-circle' : 'alert-circle';
    
    toast.innerHTML = `
        <i data-lucide="${icon}" class="toast-icon"></i>
        <div class="toast-content">${message}</div>
    `;

    container.appendChild(toast);
    lucide.createIcons();

    // Auto remove after 4 seconds
    setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Global error handling for IPC calls
window.handleIPC = async (channel, ...args) => {
    try {
        const res = await window.electron.invoke(channel, ...args);
        if (res && res.success === false) {
            showToast(res.error || 'An error occurred', 'error');
            return res;
        }
        return res;
    } catch (err) {
        showToast(err.message || 'Connection error', 'error');
        return { success: false, error: err.message };
    }
};

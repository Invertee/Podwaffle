const queue = {
  container: null,
  
  render(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    
    this.container.innerHTML = `
      <div class="queue-header">
        <h2 class="queue-title">Up Next</h2>
        <button id="queue-close" class="btn-icon"><svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
      </div>
      <div id="queue-list" class="queue-list"></div>
    `;
    
    this.container.style.display = 'none';
    this.container.classList.remove('visible');
    document.getElementById('queue-close').addEventListener('click', () => this.hide());
    
    if (window.player) {
      window.player.onStateChange((state) => this.updateList(state.queue));
    }
  },
  
  show() {
    if (this.container) {
      this.container.classList.add('visible');
      this.container.style.display = 'flex';
    }
  },
  
  hide() {
    if (this.container) {
      this.container.classList.remove('visible');
      this.container.style.display = 'none';
    }
  },
  
  toggle() {
    if (!this.container) return;
    if (this.container.classList.contains('visible')) {
      this.hide();
    } else {
      this.show();
    }
  },
  
  updateList(items) {
    const listEl = document.getElementById('queue-list');
    if (!listEl) return;
    
    if (!items || items.length === 0) {
      listEl.innerHTML = `
        <div class="queue-empty">
          <svg viewBox="0 0 24 24" width="48" height="48" stroke="var(--text-muted)" stroke-width="1" fill="none"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
          <p>Your queue is empty</p>
        </div>
      `;
      return;
    }
    
    let html = '';
    items.forEach((item, index) => {
      const durationStr = window.formatDuration ? window.formatDuration(item.duration) : '';
      html += `
        <div class="queue-item" draggable="true" data-index="${index}">
          <div class="queue-drag-handle">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line></svg>
          </div>
          <!-- Artwork disabled for now -->
          <div class="queue-item-thumb-placeholder" aria-hidden="true"></div>
          <div class="queue-item-info">
            <div class="queue-item-title">${item.title}</div>
            <div class="queue-item-podcast">${item.podcastTitle}</div>
          </div>
          ${durationStr ? `<div class="queue-item-duration">${durationStr}</div>` : ''}
          <button class="btn-icon queue-item-play-now" data-index="${index}" title="Play now">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>
          </button>
          <button class="btn-icon queue-item-remove" data-index="${index}" title="Remove">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      `;
    });
    
    listEl.innerHTML = html;
    
    // Bind remove events
    listEl.querySelectorAll('.queue-item-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(e.currentTarget.dataset.index);
        if (window.player) window.player.removeFromQueue(idx);
      });
    });

    listEl.querySelectorAll('.queue-item-play-now').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(e.currentTarget.dataset.index);
        if (window.player && typeof window.player.playFromQueue === 'function') {
          window.player.playFromQueue(idx);
        }
      });
    });
    
    // Bind drag events
    let draggedIndex = null;
    
    listEl.querySelectorAll('.queue-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        draggedIndex = parseInt(item.dataset.index);
        e.dataTransfer.effectAllowed = 'move';
        // Need to set data for Firefox
        e.dataTransfer.setData('text/plain', draggedIndex);
        setTimeout(() => item.classList.add('dragging'), 0);
      });
      
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        listEl.querySelectorAll('.queue-item').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
      });
      
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        const targetIndex = parseInt(item.dataset.index);
        if (targetIndex === draggedIndex) return;
        
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        
        listEl.querySelectorAll('.queue-item').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
        
        if (e.clientY < midY) {
          item.classList.add('drag-over-top');
        } else {
          item.classList.add('drag-over-bottom');
        }
      });
      
      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetIndex = parseInt(item.dataset.index);
        if (draggedIndex === null || targetIndex === draggedIndex) return;
        
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        
        let insertIndex = targetIndex;
        if (e.clientY > midY) {
          insertIndex++; // Insert after
        }
        
        if (window.player) window.player.reorderQueue(draggedIndex, insertIndex);
      });
    });
  }
};

window.queue = queue;

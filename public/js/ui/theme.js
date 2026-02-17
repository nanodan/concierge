// --- Theme management (light/dark/auto and color themes) ---
import { haptic, showToast } from '../utils.js';
import * as state from '../state.js';
import { THEME_TRANSITION_DURATION } from '../constants.js';

// DOM elements (set by init)
let themeDropdown = null;
let colorThemeDropdown = null;
let moreMenuBtn = null;
let moreMenuDropdown = null;
let moreColorTheme = null;
let moreThemeToggle = null;
let moreThemeIcon = null;
let moreThemeLabel = null;
let colorThemeLink = null;

// --- Color Theme Definitions ---
export const COLOR_THEMES = {
  darjeeling: { name: 'Darjeeling', icon: '\u{1F3DC}' },
  budapest: { name: 'Budapest', icon: '\u{1F3E8}' },
  moonrise: { name: 'Moonrise', icon: '\u{1F3D5}' },
  aquatic: { name: 'Aquatic', icon: '\u{1F6A2}' },
  fjord: { name: 'Fjord', icon: '\u{1F3D4}' },
  monokai: { name: 'Monokai', icon: '\u{1F4BB}' },
  catppuccin: { name: 'Catppuccin', icon: '\u{1F431}' },
  paper: { name: 'Paper', icon: '\u{1F4DC}' }
};

export function initTheme(elements) {
  themeDropdown = elements.themeDropdown;
  colorThemeDropdown = elements.colorThemeDropdown;
  moreMenuBtn = elements.moreMenuBtn;
  moreMenuDropdown = elements.moreMenuDropdown;
  moreColorTheme = elements.moreColorTheme;
  moreThemeToggle = elements.moreThemeToggle;
  moreThemeIcon = elements.moreThemeIcon;
  moreThemeLabel = elements.moreThemeLabel;
  colorThemeLink = document.getElementById('color-theme-link');

  // Apply initial themes
  applyTheme();
  applyColorTheme();
  updateThemeIcon();
  updateColorThemeIcon();
}

// --- Light/Dark/Auto Theme ---
export function applyTheme(animate = false) {
  let effective = state.getCurrentTheme();
  if (effective === 'auto') {
    effective = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  // Smooth transition when toggling themes
  if (animate) {
    document.documentElement.classList.add('theme-transitioning');
    setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), THEME_TRANSITION_DURATION);
  }

  document.documentElement.setAttribute('data-theme', effective);
  // Update status bar color from CSS variable
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    // Read the theme color from the CSS variable after it's been applied
    setTimeout(() => {
      const computed = getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim();
      if (computed) meta.content = computed;
    }, 10);
  }
}

export function selectTheme(newTheme) {
  haptic();
  state.setCurrentTheme(newTheme);
  applyTheme(true); // animate the transition
  updateThemeIcon();
  // Don't close dropdown - let user compare themes by clicking through
  const labels = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  showToast(`Theme: ${labels[newTheme]}`);
}

export function updateThemeIcon() {
  const currentTheme = state.getCurrentTheme();
  const labels = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  const svgPaths = {
    auto: '<circle cx="12" cy="12" r="10"/><path d="M12 2v20"/><path d="M12 2a10 10 0 0 1 0 20"/>',
    light: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    dark: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
  };

  // Update the more menu icon and label (home page)
  if (moreThemeIcon) {
    moreThemeIcon.innerHTML = svgPaths[currentTheme] || svgPaths.auto;
  }

  if (moreThemeLabel) {
    moreThemeLabel.textContent = labels[currentTheme] || 'Auto';
  }

  // Update the chat more menu icon and label
  const chatMoreThemeIcon = document.getElementById('chat-more-theme-icon');
  const chatMoreThemeLabel = document.getElementById('chat-more-theme-label');

  if (chatMoreThemeIcon) {
    chatMoreThemeIcon.innerHTML = svgPaths[currentTheme] || svgPaths.auto;
  }

  if (chatMoreThemeLabel) {
    chatMoreThemeLabel.textContent = labels[currentTheme] || 'Auto';
  }

  // Update active state in dropdown
  if (themeDropdown) {
    themeDropdown.querySelectorAll('.theme-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.theme === currentTheme);
    });
  }
}

// --- More Menu ---
export function toggleMoreMenu() {
  if (!moreMenuDropdown || !moreMenuBtn) return;
  const isHidden = moreMenuDropdown.classList.contains('hidden');
  if (isHidden) {
    closeThemeDropdown();
    closeColorThemeDropdown();
    moreMenuDropdown.classList.remove('hidden');
    setTimeout(() => {
      document.addEventListener('click', closeMoreMenuOnOutsideClick);
    }, 0);
  } else {
    closeMoreMenu();
  }
}

export function closeMoreMenu() {
  if (!moreMenuDropdown) return;
  moreMenuDropdown.classList.add('hidden');
  document.removeEventListener('click', closeMoreMenuOnOutsideClick);
}

function closeMoreMenuOnOutsideClick(e) {
  if (!moreMenuDropdown.contains(e.target) && e.target !== moreMenuBtn && !moreMenuBtn.contains(e.target)) {
    closeMoreMenu();
  }
}

export function toggleThemeDropdown(anchorBtn = null, closeMenuCallback = null) {
  if (!themeDropdown) return;
  const isHidden = themeDropdown.classList.contains('hidden');

  // Get position before closing more menu
  let top = 60;
  let right = 12;
  const anchor = anchorBtn || moreMenuBtn;
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    top = rect.bottom + 4;
    right = window.innerWidth - rect.right;
  }

  if (closeMenuCallback) {
    closeMenuCallback();
  } else {
    closeMoreMenu();
  }
  if (isHidden) {
    closeColorThemeDropdown();
    themeDropdown.style.top = `${top}px`;
    themeDropdown.style.right = `${right}px`;
    themeDropdown.classList.remove('hidden');
    setTimeout(() => {
      document.addEventListener('click', closeThemeDropdownOnOutsideClick);
    }, 0);
  } else {
    closeThemeDropdown();
  }
}

export function closeThemeDropdown() {
  if (!themeDropdown) return;
  themeDropdown.classList.add('hidden');
  document.removeEventListener('click', closeThemeDropdownOnOutsideClick);
}

function closeThemeDropdownOnOutsideClick(e) {
  if (!themeDropdown.contains(e.target)) {
    closeThemeDropdown();
  }
}

// --- Color Theme ---
export function applyColorTheme(animate = false) {
  const theme = state.getCurrentColorTheme();
  if (!colorThemeLink) return;

  if (animate) {
    document.documentElement.classList.add('theme-transitioning');
    setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), THEME_TRANSITION_DURATION);
  }

  colorThemeLink.href = `/css/themes/${theme}.css`;

  // Update status bar color after CSS loads
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    setTimeout(() => {
      const computed = getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim();
      if (computed) meta.content = computed;
    }, 50);
  }
}

export function toggleColorThemeDropdown(anchorBtn = null, closeMenuCallback = null) {
  if (!colorThemeDropdown) return;
  const isHidden = colorThemeDropdown.classList.contains('hidden');

  // Get position before closing more menu
  let top = 60;
  let right = 12;
  const anchor = anchorBtn || moreMenuBtn;
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    top = rect.bottom + 4;
    right = window.innerWidth - rect.right;
  }

  if (closeMenuCallback) {
    closeMenuCallback();
  } else {
    closeMoreMenu();
  }
  if (isHidden) {
    closeThemeDropdown();
    colorThemeDropdown.style.top = `${top}px`;
    colorThemeDropdown.style.right = `${right}px`;
    colorThemeDropdown.classList.remove('hidden');
    setTimeout(() => {
      document.addEventListener('click', closeColorThemeDropdownOnOutsideClick);
    }, 0);
  } else {
    closeColorThemeDropdown();
  }
}

export function closeColorThemeDropdown() {
  if (!colorThemeDropdown) return;
  colorThemeDropdown.classList.add('hidden');
  document.removeEventListener('click', closeColorThemeDropdownOnOutsideClick);
}

function closeColorThemeDropdownOnOutsideClick(e) {
  if (!colorThemeDropdown.contains(e.target)) {
    closeColorThemeDropdown();
  }
}

export function selectColorTheme(newTheme) {
  haptic();
  state.setCurrentColorTheme(newTheme);
  applyColorTheme(true);
  updateColorThemeIcon();
  // Don't close dropdown - let user compare themes by clicking through
  const info = COLOR_THEMES[newTheme] || { name: newTheme };
  showToast(`Color theme: ${info.name}`);
}

export function updateColorThemeIcon() {
  // Update active state in dropdown
  if (colorThemeDropdown) {
    const currentColorTheme = state.getCurrentColorTheme();
    colorThemeDropdown.querySelectorAll('.theme-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.colorTheme === currentColorTheme);
    });
  }
}

// --- Event listener setup for theme-related elements ---
export function setupThemeEventListeners() {
  // More menu button
  if (moreMenuBtn) {
    moreMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMoreMenu();
    });
  }

  // More menu items
  if (moreColorTheme) {
    moreColorTheme.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleColorThemeDropdown();
    });
  }

  if (moreThemeToggle) {
    moreThemeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleThemeDropdown();
    });
  }

  // Theme dropdown (light/dark/auto)
  if (themeDropdown) {
    themeDropdown.addEventListener('click', (e) => {
      const option = e.target.closest('.theme-option');
      if (option && option.dataset.theme) {
        selectTheme(option.dataset.theme);
      }
    });
  }

  // Color theme dropdown
  if (colorThemeDropdown) {
    colorThemeDropdown.addEventListener('click', (e) => {
      const option = e.target.closest('.theme-option');
      if (option && option.dataset.colorTheme) {
        selectColorTheme(option.dataset.colorTheme);
      }
    });
  }

  // Listen for OS theme changes when in auto mode
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (state.getCurrentTheme() === 'auto') applyTheme();
  });
}

// --- Frontend Constants ---
// Centralized configuration values for the UI layer

// Haptic feedback durations (ms)
export const HAPTIC_LIGHT = 10;       // Light tap feedback for most interactions
export const HAPTIC_MEDIUM = 20;      // Medium feedback (unused currently, placeholder)
export const HAPTIC_STRONG = 50;      // Strong feedback for important actions

// Toast/notification durations (ms)
export const TOAST_DURATION_DEFAULT = 3000;  // Standard toast duration
export const DELETE_UNDO_TIMEOUT = 5000;     // Soft delete undo window

// Copy feedback duration (ms)
export const COPY_FEEDBACK_DURATION = 1500;  // "Copied!" button text reset

// Touch gesture thresholds
export const SWIPE_THRESHOLD = 60;           // Min swipe distance to trigger action
export const SWIPE_ACTION_WIDTH = 100;       // Width of swipe action buttons
export const SWIPE_EDGE_WIDTH = 30;          // Edge detection zone for swipe-back
export const SWIPE_BACK_THRESHOLD = 80;      // Min swipe to trigger go-back
export const LONG_PRESS_DURATION = 500;      // Long press timer duration (ms)

// Pull-to-refresh
export const PULL_THRESHOLD = 80;            // Min pull distance to trigger refresh

// Scroll behavior
export const SCROLL_NEAR_BOTTOM_THRESHOLD = 150;  // Distance from bottom to be "near"
export const SCROLL_COMPACT_HEADER_THRESHOLD = 50; // Scroll distance for compact header

// Virtual scrolling / pagination
export const MESSAGES_PER_PAGE = 100;        // Messages to load per page

// Text truncation limits
export const THINKING_TEXT_TRUNCATE = 50;    // Truncate thinking status text
export const MEMORY_PREVIEW_MAX_LENGTH = 500; // Max length for memory text preview

// Markdown cache
export const MARKDOWN_CACHE_SIZE = 500;      // Max cached markdown entries

// File panel constraints
export const FILE_PANEL_MIN_WIDTH = 280;     // Minimum panel width (px)
export const FILE_PANEL_MAX_WIDTH = 800;     // Maximum panel width (px)
export const FILE_PANEL_MIN_HEIGHT = 100;    // Minimum panel height (px)

// WebSocket reconnect parameters
export const WS_RECONNECT_BASE_DELAY = 1000;   // Base reconnect delay (ms)
export const WS_RECONNECT_MAX_DELAY = 30000;   // Maximum reconnect delay (ms)
export const WS_RECONNECT_BACKOFF = 2;         // Exponential backoff multiplier

// Context compression thresholds (percentage of context limit)
export const CONTEXT_WARNING_THRESHOLD = 50;   // Show compression button at 50%
export const CONTEXT_AUTO_PROMPT_THRESHOLD = 85; // Auto-prompt for compression at 85%

// Animation delays (ms)
export const ANIMATION_DELAY_SHORT = 10;       // Short delay for CSS transitions
export const ANIMATION_DELAY_MEDIUM = 50;      // Medium delay for animations

// Branch visualization
export const BRANCH_NODE_HEIGHT = 50;          // Height of each branch node (px)

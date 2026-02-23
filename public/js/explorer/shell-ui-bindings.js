function bindDropZone(dropZone, onDropFiles) {
  if (!dropZone || !onDropFiles) return;

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    if (!dropZone.contains(e.relatedTarget)) {
      dropZone.classList.remove('drag-over');
    }
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer?.files?.length) {
      onDropFiles(e.dataTransfer.files);
    }
  });
}

function bindUpload(uploadButton, fileInput, onUploadFiles) {
  if (uploadButton && fileInput) {
    uploadButton.addEventListener('click', () => {
      fileInput.click();
    });
  }

  if (fileInput && onUploadFiles) {
    fileInput.addEventListener('change', () => {
      if (fileInput.files?.length) {
        onUploadFiles(fileInput.files);
        fileInput.value = '';
      }
    });
  }
}

function bindViewerNavigation({
  viewer,
  onViewerKeydown,
  onViewerTouchStart,
  onViewerTouchMove,
  onViewerTouchEnd,
}) {
  if (onViewerKeydown) {
    document.addEventListener('keydown', onViewerKeydown);
  }

  if (!viewer) return;
  if (onViewerTouchStart) {
    viewer.addEventListener('touchstart', onViewerTouchStart, { passive: true });
  }
  if (onViewerTouchMove) {
    viewer.addEventListener('touchmove', onViewerTouchMove, { passive: true });
  }
  if (onViewerTouchEnd) {
    viewer.addEventListener('touchend', onViewerTouchEnd, { passive: true });
  }
}

export function bindExplorerShellUi({
  upButton,
  onUp,
  refreshButton,
  onRefresh,
  uploadButton,
  fileInput,
  onUploadFiles,
  dropZone,
  onDropFiles,
  viewerCloseButton,
  onViewerClose,
  viewer,
  onViewerKeydown,
  onViewerTouchStart,
  onViewerTouchMove,
  onViewerTouchEnd,
}) {
  if (upButton && onUp) {
    upButton.addEventListener('click', onUp);
  }

  if (refreshButton && onRefresh) {
    refreshButton.addEventListener('click', onRefresh);
  }

  if (viewerCloseButton && onViewerClose) {
    viewerCloseButton.addEventListener('click', onViewerClose);
  }

  bindUpload(uploadButton, fileInput, onUploadFiles);
  bindDropZone(dropZone, onDropFiles);
  bindViewerNavigation({
    viewer,
    onViewerKeydown,
    onViewerTouchStart,
    onViewerTouchMove,
    onViewerTouchEnd,
  });
}

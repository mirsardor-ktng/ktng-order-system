'use client';

import React, { useState, useEffect } from 'react';
import { X, Download, Loader2, AlertCircle, FileText } from 'lucide-react';
import { useTranslation } from '@/i18n/context';

interface DocumentPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  fileName: string;
  uploadedAt?: string | Date | null;
  fileSize?: number | null;
  canDownload?: boolean;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  isOpen,
  onClose,
  documentId,
  fileName,
  uploadedAt,
  fileSize,
  canDownload = true
}) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setHasError(false);
    }
  }, [isOpen, documentId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const previewUrl = `/api/orders/documents/${documentId}/preview`;
  const downloadUrl = `/api/orders/documents/${documentId}/download`;

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes || bytes <= 0) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formattedDate = uploadedAt
    ? new Date(uploadedAt).toLocaleString()
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2.5 min-w-0 pr-4">
            <FileText className="h-5 w-5 text-indigo-400 shrink-0" />
            <h3 className="text-sm sm:text-base font-semibold text-slate-100 truncate">
              {fileName}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
            title={t('documents.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body / Image View */}
        <div className="relative flex-1 flex items-center justify-center bg-slate-950 p-4 min-h-[300px] overflow-auto">
          {loading && !hasError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950">
              <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
              <span className="text-xs text-slate-400">{t('documents.uploading')}</span>
            </div>
          )}

          {hasError ? (
            <div className="flex flex-col items-center justify-center gap-3 text-center p-6">
              <AlertCircle className="h-10 w-10 text-rose-500" />
              <p className="text-sm text-slate-300 font-medium">
                {t('documents.previewError')}
              </p>
              {canDownload && (
                <a
                  href={downloadUrl}
                  download={fileName}
                  className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all"
                >
                  <Download className="h-4 w-4" />
                  {t('documents.download')}
                </a>
              )}
            </div>
          ) : (
            <img
              src={previewUrl}
              alt={fileName}
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setHasError(true);
              }}
              className={`max-h-[65vh] w-auto max-w-full object-contain rounded-lg shadow-md transition-opacity duration-200 ${
                loading ? 'opacity-0' : 'opacity-100'
              }`}
            />
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3.5 border-t border-slate-800 bg-slate-900/90 text-xs text-slate-400">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 w-full sm:w-auto">
            {formattedDate && (
              <span>
                <strong className="text-slate-300">{t('documents.uploadedAt')}:</strong> {formattedDate}
              </span>
            )}
            {fileSize ? (
              <span>
                <strong className="text-slate-300">{t('documents.fileSize')}:</strong> {formatFileSize(fileSize)}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {canDownload && !hasError && (
              <a
                href={downloadUrl}
                download={fileName}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-all shadow-md shadow-indigo-600/20"
              >
                <Download className="h-3.5 w-3.5" />
                <span>{t('documents.download')}</span>
              </a>
            )}
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition-colors"
            >
              {t('documents.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

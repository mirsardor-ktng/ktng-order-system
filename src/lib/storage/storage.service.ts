import { uploadFile, downloadFile, deleteFile } from '../gdrive';

export interface IStorageService {
  uploadFile(
    fileName: string,
    content: Buffer | string,
    mimeType: string,
    folderName: 'Orders' | 'Templates' | 'Users' | 'Logs'
  ): Promise<{ success: boolean; fileId: string; path?: string; message: string }>;

  downloadFile(
    fileId: string,
    fileName: string,
    folderName: 'Orders' | 'Templates' | 'Users' | 'Logs'
  ): Promise<Buffer>;

  deleteFile(fileId: string): Promise<boolean>;
}

class GoogleDriveStorageService implements IStorageService {
  async uploadFile(
    fileName: string,
    content: Buffer | string,
    mimeType: string,
    folderName: 'Orders' | 'Templates' | 'Users' | 'Logs'
  ) {
    return uploadFile(fileName, content, mimeType, folderName);
  }

  async downloadFile(
    fileId: string,
    fileName: string,
    folderName: 'Orders' | 'Templates' | 'Users' | 'Logs'
  ) {
    return downloadFile(fileId, fileName, folderName);
  }

  async deleteFile(fileId: string) {
    return deleteFile(fileId);
  }
}

export const storageService: IStorageService = new GoogleDriveStorageService();

/** Android/iOS: write the file to the cache directory and open the system share sheet. (Web: saveFile.ts.) */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { t } from '@/i18n';

export async function saveTextFile(filename: string, content: string, mimeType = 'text/csv'): Promise<void> {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error(t('reports.saveFilenative.sharing_is_not_available_on_this_device'));
  }
  await Sharing.shareAsync(file.uri, {
    mimeType,
    UTI: mimeType === 'text/csv' ? 'public.comma-separated-values-text' : undefined,
    dialogTitle: filename,
  });
}

/**
 * Offers text to the user as a file. The object URL is released a little later: releasing it
 * at once can make the browser lose the file name (it then saves «download»).
 */
export function saveTextFile(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

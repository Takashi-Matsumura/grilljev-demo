/** ブラウザにファイルとして保存させる（サーバは通さない。内容は外に出ない）。 */
export function download(name: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // すぐ解放するとダウンロードが始まる前に無効になる環境があるので、少し待つ
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

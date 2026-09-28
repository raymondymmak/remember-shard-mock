// File list and folder drops. The browser never uploads them.

export function entriesFromFileList(fileList) {
  return [...(fileList || [])].map((file) => ({
    file,
    name: file.name,
    relativePath: file.webkitRelativePath || file.name,
    type: file.type || "",
    size: file.size,
    lastModified: file.lastModified,
  }));
}

function readAllEntries(directory) {
  const reader = directory.createReader();
  const all = [];
  return new Promise((resolve, reject) => {
    const read = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(all);
          return;
        }
        all.push(...batch);
        read();
      }, reject);
    };
    read();
  });
}

async function walkEntry(entry, parent, out) {
  const path = parent ? `${parent}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push({
      file,
      name: file.name,
      relativePath: path,
      type: file.type || "",
      size: file.size,
      lastModified: file.lastModified,
    });
    return;
  }
  if (!entry.isDirectory) return;
  const children = await readAllEntries(entry);
  for (const child of children) {
    await walkEntry(child, path, out);
  }
}

export async function entriesFromDataTransfer(dataTransfer) {
  const items = [...(dataTransfer?.items || [])];
  const handles = items
    .filter((item) => item.kind === "file" && typeof item.webkitGetAsEntry === "function")
    .map((item) => item.webkitGetAsEntry())
    .filter(Boolean);

  if (!handles.length || !handles.some((entry) => entry.isDirectory)) {
    return entriesFromFileList(dataTransfer?.files || []);
  }

  const files = [];
  for (const entry of handles) {
    await walkEntry(entry, "", files);
  }
  return files;
}

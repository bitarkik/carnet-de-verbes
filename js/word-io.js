// ==========================================================================
// Real OpenXML Word (.docx) Exporter & Browser-Native .docx Reader
// ==========================================================================

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createStoreZip(files) {
  const enc = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const dataBytes = enc.encode(f.content);
    const crc = crc32(dataBytes);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8
    lh.setUint16(8, 0, true);      // STORE
    lh.setUint32(14, crc, true);
    lh.setUint32(18, dataBytes.length, true);
    lh.setUint32(22, dataBytes.length, true);
    lh.setUint16(26, nameBytes.length, true);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, dataBytes.length, true);
    ch.setUint32(24, dataBytes.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, offset, true);

    localParts.push(new Uint8Array(lh.buffer), nameBytes, dataBytes);
    centralParts.push(new Uint8Array(ch.buffer), nameBytes);
    offset += 30 + nameBytes.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((s, b) => s + b.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);

  return new Blob([...localParts, ...centralParts, new Uint8Array(eocd.buffer)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
}

function xmlEsc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function generateDocxBlob(verbs) {
  const wPara = (text, { bold = false, italic = false, sizeHalfPt = 21, color = "1E293B", spacingAfter = 80 } = {}) => `
    <w:p>
      <w:pPr><w:spacing w:after="${spacingAfter}"/></w:pPr>
      <w:r>
        <w:rPr>
          ${bold ? "<w:b/>" : ""}
          ${italic ? "<w:i/>" : ""}
          <w:color w:val="${color}"/>
          <w:sz w:val="${sizeHalfPt}"/>
        </w:rPr>
        <w:t xml:space="preserve">${xmlEsc(text)}</w:t>
      </w:r>
    </w:p>`;

  const bodyXml = [
    wPara("Carnet de Verbes — Personal French Verb Notebook", { bold: true, sizeHalfPt: 34, color: "0E9474", spacingAfter: 60 }),
    wPara(`Total saved verbs: ${verbs.length}`, { italic: true, sizeHalfPt: 19, color: "64748B", spacingAfter: 240 }),
    ...verbs.map((v, idx) => {
      const cleanForms = (arr) => (arr || []).map((f) => f.replace(/\*/g, ""));
      const pres = cleanForms(v.tenses?.present);
      const pc = cleanForms(v.tenses?.passeCompose);
      const imp = cleanForms(v.tenses?.imparfait);
      const fut = cleanForms(v.tenses?.futur);
      const cond = cleanForms(v.tenses?.conditionnel);

      const makeTable = (headers, cols) => {
        const rows = [0, 1, 2, 3, 4, 5].map((r) => `
          <w:tr>
            ${cols.map((col) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${wPara(col[r] || "", { sizeHalfPt: 19, spacingAfter: 40 })}</w:tc>`).join("")}
          </w:tr>`).join("");

        return `
          <w:tbl>
            <w:tblPr>
              <w:tblBorders>
                <w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
                <w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
                <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
              </w:tblBorders>
            </w:tblPr>
            <w:tr>
              ${headers.map((h) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${wPara(h, { bold: true, sizeHalfPt: 19, color: "0E9474", spacingAfter: 50 })}</w:tc>`).join("")}
            </w:tr>
            ${rows}
          </w:tbl>`;
      };

      const exLine = (v.examples || []).map((e) => `${e.fr} (${e.en})`).join("  •  ");
      return [
        wPara(`${idx + 1}. ${v.infinitive} — ${v.meaning}`, { bold: true, sizeHalfPt: 27, color: "0F172A", spacingAfter: 40 }),
        wPara(`${v.group}  |  Auxiliary: ${v.auxiliary} + ${v.pastParticiple}`, { sizeHalfPt: 19, color: "475569", spacingAfter: 70 }),
        wPara(`Grammar Tips: ${v.duolingoTips?.auxiliaryNote || ""}  •  ${v.duolingoTips?.preposition || ""}`, { sizeHalfPt: 19, color: "334155", spacingAfter: 90 }),
        makeTable(["Présent", "Passé Composé", "Imparfait"], [pres, pc, imp]),
        wPara("", { sizeHalfPt: 10, spacingAfter: 40 }),
        makeTable(["Futur Simple", "Conditionnel", "Pronunciation Tip"], [
          fut,
          cond,
          [v.duolingoTips?.homophone || "", v.duolingoTips?.extra || "", "", "", "", ""]
        ]),
        exLine ? wPara(`Examples: ${exLine}`, { italic: true, sizeHalfPt: 19, color: "334155", spacingAfter: 60 }) : "",
        v.note ? wPara(`My Note: ${v.note}`, { sizeHalfPt: 19, color: "0E9474", spacingAfter: 60 }) : "",
        wPara("", { sizeHalfPt: 16, spacingAfter: 180 })
      ].join("");
    })
  ].join("");

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>${bodyXml}</w:body>
    </w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`;

  return createStoreZip([
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: rels },
    { name: "word/document.xml", content: docXml }
  ]);
}

// Unzip word/document.xml from an existing Microsoft Word .docx file right in the browser!
export async function extractTextFromDocx(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const dec = new TextDecoder("utf-8");

  // Locate End of Central Directory (0x06054b50)
  let eocdPos = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) throw new Error("Not a valid .docx archive (if it is an old .doc file, save it as .docx first).");

  const cdCount = view.getUint16(eocdPos + 10, true);
  let ptr = view.getUint32(eocdPos + 16, true);

  for (let i = 0; i < cdCount; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    if (name === "word/document.xml") {
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const compBytes = bytes.subarray(dataStart, dataStart + compSize);

      let xmlText = "";
      if (method === 0) {
        xmlText = dec.decode(compBytes);
      } else if (method === 8 && typeof DecompressionStream !== "undefined") {
        const ds = new DecompressionStream("deflate-raw");
        const writer = ds.writable.getWriter();
        writer.write(compBytes);
        writer.close();
        const decompressed = await new Response(ds.readable).arrayBuffer();
        xmlText = dec.decode(decompressed);
      } else {
        throw new Error("Unsupported compression method in .docx file.");
      }

      // Convert paragraph/row breaks to newlines and strip XML tags
      return xmlText
        .replace(/<\/w:p>/g, "\n")
        .replace(/<\/w:tr>/g, "\n")
        .replace(/<\/w:tc>/g, "  ")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    }

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  throw new Error("Could not find word/document.xml inside this .docx file.");
}

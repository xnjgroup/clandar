/**
 * A one-page text PDF (Helvetica, US Letter) — for sample-data documents like a permit or an
 * itinerary. Plain PDF 1.4 written by hand: a title, then lines (an empty line is a gap).
 */
export function textPdf(title: string, lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "-");
  const ops = ["BT", "/F2 20 Tf", "72 720 Td", `(${esc(title)}) Tj`, "/F1 11 Tf", "0 -34 Td"];
  for (const line of lines) {
    if (line.startsWith("## ")) ops.push("/F2 12 Tf", `(${esc(line.slice(3))}) Tj`, "/F1 11 Tf", "0 -18 Td");
    else ops.push(`(${esc(line)}) Tj`, line ? "0 -16 Td" : "0 -8 Td");
  }
  ops.push("ET");
  const stream = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

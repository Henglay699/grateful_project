import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BackLink, backRow } from '../components/BackLink';
import {
  CompressTool,
  ImagesToPdfTool,
  MergeTool,
  OrganizeTool,
  PdfConvertTool,
  PageNumbersTool,
  PdfToImagesTool,
  PdfToTextTool,
  RemovePagesTool,
  SplitTool,
  WatermarkTool,
} from './pdftools/tools';
import { EditPdfTool } from './pdftools/editor/EditPdfTool';
import s from './pdftools/PdfTools.module.css';

const svg = (d: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {d}
  </svg>
);

interface Tool {
  id: string;
  name: string;
  desc: string;
  group: string;
  icon: ReactNode;
  Panel: () => ReactNode;
}

const TOOLS: Tool[] = [
  {
    id: 'edit',
    name: 'Edit PDF',
    desc: 'Add text, images, signatures, highlights and drawings, or white out content.',
    group: 'Edit',
    icon: svg(<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />),
    Panel: EditPdfTool,
  },
  {
    id: 'page-numbers',
    name: 'Page numbers',
    desc: 'Number every page — choose the position, format and first number.',
    group: 'Edit',
    icon: svg(<path d="M4 6h16M4 12h10M4 18h6M17 15h3v6M17 21h4" />),
    Panel: PageNumbersTool,
  },
  {
    id: 'watermark',
    name: 'Watermark',
    desc: 'Stamp text like CONFIDENTIAL or COPY across every page.',
    group: 'Edit',
    icon: svg(<path d="M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0z" />),
    Panel: WatermarkTool,
  },
  {
    id: 'merge',
    name: 'Merge PDF',
    desc: 'Combine several PDFs into one, in the order you choose.',
    group: 'Organize',
    icon: svg(
      <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M12 8v8M8 12h8" />,
    ),
    Panel: MergeTool,
  },
  {
    id: 'split',
    name: 'Split PDF',
    desc: 'Split by page ranges, extract pages, or save every page separately.',
    group: 'Organize',
    icon: svg(<path d="M6 3v18M18 3v18M10 12h4M3 8l3-3 3 3M15 16l3 3 3-3" />),
    Panel: SplitTool,
  },
  {
    id: 'remove-pages',
    name: 'Remove pages',
    desc: 'Pick pages to delete by clicking thumbnails or typing ranges.',
    group: 'Organize',
    icon: svg(
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M9.5 12.5l5 5M14.5 12.5l-5 5" />
      </>,
    ),
    Panel: RemovePagesTool,
  },
  {
    id: 'organize',
    name: 'Organize pages',
    desc: 'Reorder, rotate, duplicate or delete pages with thumbnails.',
    group: 'Organize',
    icon: svg(
      <>
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="9" rx="1" />
        <path d="M7 16v2a2 2 0 0 0 2 2h8M14 17l3 3-3 3" />
      </>,
    ),
    Panel: OrganizeTool,
  },
  {
    id: 'compress',
    name: 'Compress PDF',
    desc: 'Shrink one or many PDFs for email or upload, especially scanned documents.',
    group: 'Optimize',
    icon: svg(<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />),
    Panel: CompressTool,
  },
  {
    id: 'images-to-pdf',
    name: 'Images to PDF',
    desc: 'Turn photos and scans (JPG, PNG, WebP) into one PDF.',
    group: 'Convert',
    icon: svg(
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </>,
    ),
    Panel: ImagesToPdfTool,
  },
  {
    id: 'pdf-to-images',
    name: 'PDF to images',
    desc: 'Save each page as a JPG or PNG, up to print quality.',
    group: 'Convert',
    icon: svg(
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M8 17l3-3 2 2 3-3" />
      </>,
    ),
    Panel: PdfToImagesTool,
  },
  {
    id: 'pdf-to-text',
    name: 'PDF to text',
    desc: 'Copy out the text of a PDF, or save it as a .txt file. Scans have no text to copy.',
    group: 'Convert',
    icon: svg(
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M8 13h8M8 17h5" />
      </>,
    ),
    Panel: PdfToTextTool,
  },
  {
    id: 'pdf-to-word',
    name: 'PDF to Word',
    desc: 'Turn a PDF into an editable Word file (.docx), keeping the text layout.',
    group: 'Convert',
    icon: svg(
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M8 12l1.5 6 2.5-4.5 2.5 4.5 1.5-6" />
      </>,
    ),
    Panel: () => <PdfConvertTool to="docx" />,
  },
  {
    id: 'pdf-to-excel',
    name: 'PDF to Excel',
    desc: 'Pull tables out of a PDF into a spreadsheet (.xlsx), with amounts as numbers.',
    group: 'Convert',
    icon: svg(
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M3 15h18M9 3v18" />
      </>,
    ),
    Panel: () => <PdfConvertTool to="xlsx" />,
  },
];

const GROUPS = [...new Set(TOOLS.map((t) => t.group))];

/** PDF Tools: merge, split, organize, compress and convert, all inside the browser. */
export function PdfToolsPage() {
  const [params, setParams] = useSearchParams();
  const tool = TOOLS.find((t) => t.id === params.get('tool'));

  if (tool)
    return (
      <section className="view active" id="view-pdftools">
        <div className="card">
          <div className="card-header-row">
            <div className={backRow}>
              <BackLink to="/pdf-tools" label="All PDF tools" />
              <div>
                <h3 style={{ margin: 0 }}>{tool.name}</h3>
                <div className={s.toolDesc}>{tool.desc}</div>
              </div>
            </div>
          </div>
          {/* key: switching tools starts from a clean panel */}
          <tool.Panel key={tool.id} />
        </div>
      </section>
    );

  return (
    <section className="view active" id="view-pdftools">
      <div className="card">
        <div className="card-header-row">
          <div>
            <h3 style={{ margin: 0 }}>PDF Tools</h3>
            <div className={s.toolDesc}>
              Files are processed on this computer and are never uploaded.
            </div>
          </div>
        </div>
        {GROUPS.map((g) => (
          <div key={g} className={s.group}>
            <div className={s.sectionHeading}>{g}</div>
            <div className={s.grid}>
              {TOOLS.filter((t) => t.group === g).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={s.tool}
                  onClick={() => setParams({ tool: t.id })}
                >
                  <span className={s.toolIcon}>{t.icon}</span>
                  <span>
                    <div className={s.toolName}>{t.name}</div>
                    <div className={s.toolDesc}>{t.desc}</div>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

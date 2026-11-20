import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { ArrowDownToLine, BookOpen, Check, ChevronDown, ChevronRight, CircleAlert, Code2, Copy, Download, FileCode2, FileImage, FileJson, FolderOpen, Frame, GalleryHorizontalEnd, HelpCircle, Layers3, LoaderCircle, Maximize2, PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, RefreshCw, RotateCcw, Save, Scan, Settings2, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react';
import SourceEditor from './components/SourceEditor';
import DiagramStage from './components/DiagramStage';
import Inspector from './components/Inspector';
import Modal from './components/Modal';
import { TEMPLATES } from './lib/templates';
import { DEFAULT_SETTINGS, getTheme } from './lib/themes';
import { createDocument, downloadText, loadWorkspace, normalizeSource, parseProject, safeFilename, saveWorkspace } from './lib/storage';
import { renderDiagram } from './lib/render';
import { buildExportSvg, downloadSvg, exportPng, exportPresentation } from './lib/export';
import type { DiagramTemplate, RenderResult, StudioDocument, StudioSettings } from './types';

type DialogName = 'examples'|'projects'|'export'|'help'|null;
type WorkspaceTab = 'canvas'|'source'|'style';
type ExportFormat = 'png'|'svg'|'html'|'project'|'source';

function initialsState() {
  const workspace = loadWorkspace();
  if(workspace.documents.length) return {...workspace, activeId:workspace.activeId||workspace.documents[0].id};
  const doc = createDocument(TEMPLATES[0]);
  return {...workspace, documents:[doc],activeId:doc.id};
}

function App() {
  const [initial] = useState(initialsState);
  const [documents, setDocuments] = useState<StudioDocument[]>(initial.documents);
  const [activeId, setActiveId] = useState(initial.activeId);
  const [dialog,setDialog] = useState<DialogName>(null);
  const [tab,setTab] = useState<WorkspaceTab>('canvas');
  const [present,setPresent] = useState(false);
  const [sourceVisible,setSourceVisible] = useState(true);
  const [inspectorVisible,setInspectorVisible] = useState(true);
  const [renderResult,setRenderResult] = useState<RenderResult|null>(null);
  const [renderedDocument,setRenderedDocument] = useState<StudioDocument|null>(null);
  const [renderError,setRenderError] = useState('');
  const [rendering,setRendering] = useState(true);
  const [renderKey,setRenderKey] = useState(0);
  const [lastFingerprint,setLastFingerprint] = useState('');
  const [live,setLive] = useState(true);
  const [selectedKey,setSelectedKey] = useState<string|null>(null);
  const [replayKey,setReplayKey] = useState(0);
  const [fitRequest,setFitRequest] = useState(0);
  const [motionPaused,setMotionPaused] = useState(false);
  const [reducedMotion,setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [saveState,setSaveState] = useState<'saved'|'saving'|'error'>('saved');
  const [storageWarning,setStorageWarning] = useState(initial.warning||'');
  const [autosave,setAutosave] = useState(!initial.warning);
  const [externalChange,setExternalChange] = useState(false);
  const [toast,setToast] = useState('');
  const [exampleCategory,setExampleCategory] = useState('All');
  const [exportFormat,setExportFormat] = useState<ExportFormat>('png');
  const [exportScale,setExportScale] = useState(2);
  const [exportTransparent,setExportTransparent] = useState(false);
  const [exportFrame,setExportFrame] = useState(true);
  const [exportBusy,setExportBusy] = useState(false);
  const [exportError,setExportError] = useState('');
  const [pendingDelete,setPendingDelete] = useState<string|null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastManualRender = useRef(-1);
  const previousActiveId = useRef(activeId);
  const document = documents.find(d=>d.id===activeId)||documents[0];
  const documentRef = useRef(document); documentRef.current=document;
  const fingerprint = useMemo(()=>JSON.stringify([document.id,document.source,document.settings,document.nodeAccents]),[document.id,document.source,document.settings,document.nodeAccents]);
  const stale = lastFingerprint!==fingerprint;
  const workspaceRef = useRef({documents,activeId,autosave}); workspaceRef.current={documents,activeId,autosave};

  const notify = useCallback((message:string) => setToast(message),[]);
  useEffect(()=> {if(!toast)return;const timer=window.setTimeout(()=>setToast(''),4200);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=> {const media=window.matchMedia('(prefers-reduced-motion: reduce)');const change=()=>setReducedMotion(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=> {
    if(!autosave) return;
    setSaveState('saving');
    const timer=window.setTimeout(()=>{const result=saveWorkspace(documents,activeId);setSaveState(result.ok?'saved':'error');if(!result.ok)setStorageWarning(result.error||'Browser storage is unavailable. Download a project to keep your work.');else setStorageWarning('');},350);
    return()=>clearTimeout(timer);
  },[documents,activeId,autosave]);
  useEffect(()=>{
    const flush=()=>{const latest=workspaceRef.current;if(latest.autosave)saveWorkspace(latest.documents,latest.activeId);};
    const hidden=()=>{if(globalThis.document.visibilityState==='hidden')flush();};
    window.addEventListener('pagehide',flush);globalThis.document.addEventListener('visibilitychange',hidden);
    return()=>{window.removeEventListener('pagehide',flush);globalThis.document.removeEventListener('visibilitychange',hidden);};
  },[]);
  useEffect(()=>{
    const changed=(event:StorageEvent)=>{
      if(event.key!=='meridian:v1'||event.newValue===event.oldValue)return;
      workspaceRef.current.autosave=false;
      setAutosave(false);setExternalChange(true);
      setStorageWarning('Another tab changed this workspace. Autosave is paused here to protect both copies. Download this project before reloading the workspace.');
    };
    window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);
  },[]);

  useEffect(()=> {
    const manual = lastManualRender.current!==renderKey;
    lastManualRender.current=renderKey;
    const newDocument = previousActiveId.current!==activeId;
    if(newDocument){setRenderResult(null);setSelectedKey(null);setRenderError('');previousActiveId.current=activeId;}
    if(!live && !manual && !newDocument){setRendering(false);return;}
    let cancelled=false;
    setRendering(true);
    const timer=window.setTimeout(async()=>{
      try {
        const result=await renderDiagram(normalizeSource(document.source),document.settings,document.nodeAccents);
        if(cancelled)return;
        setRenderResult(result);setRenderedDocument(document);setRenderError('');setLastFingerprint(fingerprint);
        setSelectedKey(previous=>result.nodes.some(n=>n.key===previous)?previous:null);
      } catch(error) {if(!cancelled)setRenderError(error instanceof Error?error.message.slice(0,2200):'The diagram could not render. Check the source and try again.');}
      finally {if(!cancelled)setRendering(false);}
    },manual||newDocument?10:380);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[fingerprint,live,renderKey,activeId]);

  const updateDocument = useCallback((patch:Partial<StudioDocument>)=>{
    setDocuments(list=>list.map(doc=>doc.id===activeId?{...doc,...patch,updatedAt:new Date().toISOString()}:doc));
  },[activeId]);
  const updateSettings = useCallback((patch:Partial<StudioSettings>)=>{
    setDocuments(list=>list.map(doc=>doc.id===activeId?{...doc,settings:{...doc.settings,...patch},updatedAt:new Date().toISOString()}:doc));
  },[activeId]);
  const downloadProject = useCallback(()=>{
    const doc = documentRef.current;
    downloadText(JSON.stringify(doc,null,2),`${safeFilename(doc.title)}.meridian.json`,'application/json');notify('Project downloaded. It includes your source and all styling.');
  },[notify]);
  const createProject = (template?:DiagramTemplate)=>{
    if(documents.length>=50){notify('Your workspace holds 50 projects. Download and remove an older one to make room.');return;}
    const doc = template?createDocument(template):{...createDocument(),title:'Untitled diagram',subtitle:'',source:'flowchart LR\n    idea[An idea] --> decision{A decision}\n    decision -->|Yes| result[Make it happen]\n    decision -->|Not yet| idea'};
    setDocuments(list=>[doc,...list]);setActiveId(doc.id);setDialog(null);setTab('canvas');setLive(true);
    notify(template?`Opened ${template.title} as a new project.`:'Created a new diagram.');
  };
  const copyProject = ()=>{
    if(documents.length>=50){notify('Your workspace holds 50 projects. Remove an older one first.');return;}
    const doc={...document,id:createDocument().id,title:`${document.title.slice(0,110)} copy`,updatedAt:new Date().toISOString()};
    setDocuments(list=>[doc,...list]);setActiveId(doc.id);notify('Created a separate copy.');
  };
  const importFile = async(e:ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    try {
      if(file.size>1_000_000)throw new Error('Choose a project or Mermaid file smaller than 1 MB.');
      if(documents.length>=50)throw new Error('The workspace holds 50 projects. Download and remove one before importing.');
      const text=await file.text();
      let doc:StudioDocument;
      if(file.name.toLowerCase().endsWith('.json'))doc=parseProject(text);
      else {const source=normalizeSource(text);if(source.length>100000)throw new Error('Mermaid source is limited to 100,000 characters.');doc={...createDocument(),source,title:file.name.replace(/\.(mmd|mermaid|md|txt)$/i,'').slice(0,120)||'Imported diagram',subtitle:''};}
      doc={...doc,id:createDocument().id,updatedAt:new Date().toISOString()};
      setDocuments(list=>[doc,...list]);setActiveId(doc.id);setDialog(null);setLive(true);notify(`Imported ${doc.title}.`);
    }catch(error){notify(error instanceof Error?error.message:'The file could not be imported.');}
  };
  const removeProject = ()=>{
    if(!pendingDelete)return;
    const remaining=documents.filter(d=>d.id!==pendingDelete);
    if(!remaining.length){const fresh=createDocument();setDocuments([fresh]);setActiveId(fresh.id);}
    else {setDocuments(remaining);if(activeId===pendingDelete)setActiveId(remaining[0].id);}
    setPendingDelete(null);notify('Project removed from this browser.');
  };
  const copySource = async()=>{
    try{await navigator.clipboard.writeText(document.source);notify('Mermaid source copied.');}catch{notify('Clipboard access is unavailable. Select the source and copy it, or download the .mmd file.');}
  };

  useEffect(()=>{
    const keydown=(e:KeyboardEvent)=>{
      const editing=(e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]');
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();downloadProject();return;}
      if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();setRenderKey(v=>v+1);return;}
      if(e.key==='Escape'){if(present)setPresent(false);else if(!dialog)setSelectedKey(null);return;}
      if(editing||dialog||e.metaKey||e.ctrlKey||e.altKey)return;
      if(e.key.toLowerCase()==='f'){e.preventDefault();setFitRequest(v=>v+1);}
      if(e.key.toLowerCase()==='p'){e.preventDefault();setPresent(p=>!p);}
    };
    window.addEventListener('keydown',keydown);return()=>window.removeEventListener('keydown',keydown);
  },[dialog,present,downloadProject]);

  const doExport=async()=>{
    setExportError('');setExportBusy(true);
    try{
      const filename=safeFilename(document.title);
      if(exportFormat==='project')downloadProject();
      else if(exportFormat==='source')downloadText(document.source,`${filename}.mmd`,'text/plain');
      else {
        if(!renderResult||stale||renderError)throw new Error('Render the current source successfully before exporting the picture.');
        const svg=buildExportSvg(renderResult,document,{transparent:exportTransparent,animated:exportFormat==='html',includeFrame:exportFrame});
        if(exportFormat==='svg')downloadSvg(svg,`${filename}.svg`);
        else if(exportFormat==='html')exportPresentation(svg,document);
        else {const size=await exportPng(svg,`${filename}.png`,exportScale);notify(`PNG downloaded at ${size.width.toLocaleString()} × ${size.height.toLocaleString()} pixels.`);}
      }
      if(exportFormat!=='png'&&exportFormat!=='project')notify(`${exportFormat.toUpperCase()} downloaded.`);
    }catch(error){setExportError(error instanceof Error?error.message:'The export could not be created. Try SVG or a lower PNG scale.');}
    finally{setExportBusy(false);}
  };
  const selectedNode=renderResult?.nodes.find(n=>n.key===selectedKey)||null;
  const visualExport=['svg','png','html'].includes(exportFormat);
  const categories=['All',...Array.from(new Set(TEMPLATES.map(t=>t.category)))];

  return <div className={`studio ${present?'is-presenting':''} ${sourceVisible?'':'source-hidden'} ${inspectorVisible?'':'inspector-hidden'}`}>
    <input ref={fileInput} type="file" accept=".json,.mmd,.mermaid,.md,.txt" onChange={importFile} hidden />
    {!present&&<>
      <header className="app-bar">
        <a className="brand" href="https://arbiterforge.com/" target="_blank" rel="noreferrer" aria-label="ArbiterForge home"><svg className="brand-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect width="40" height="40" rx="12" fill="#243d36"/><path d="M10 29V13l10 12 10-12v16" stroke="#b1e7d3" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/><circle cx="20" cy="9" r="1.6" fill="#b1e7d3"/></svg><span><strong>Meridian</strong><small>BY ARBITERFORGE</small></span></a>
        <span className="bar-divider" />
        <button className="project-picker" onClick={()=>setDialog('projects')} title="Open your local projects"><span className="project-name">{document.title}</span><ChevronDown size={14}/></button>
        <div className="saved-state" title={saveState==='saved'?'Saved automatically in this browser. Download a project for a portable backup.':'Browser autosave status'}>{saveState==='saving'?<LoaderCircle className="spin" size={12}/>:saveState==='error'||!autosave?<CircleAlert size={13}/>:<Check size={13}/>}<span>{!autosave?'Autosave paused':saveState==='saving'?'Saving':saveState==='error'?'Save unavailable':'Saved locally'}</span></div>
        <div className="app-actions"><button className="icon-button mobile-projects" onClick={()=>setDialog('projects')} aria-label="Open projects"><FolderOpen size={18}/></button><button className="button quiet examples-top" onClick={()=>setDialog('examples')} aria-label="Examples"><GalleryHorizontalEnd size={16}/><span>Examples</span></button><button className="button quiet present-top" onClick={()=>{setPresent(true);setFitRequest(v=>v+1);}} aria-label="Present"><Play size={15}/><span>Present</span></button><button className="button primary export-top" onClick={()=>{setExportError('');setDialog('export');}}><ArrowDownToLine size={16}/><span>Export</span></button></div>
      </header>
      {storageWarning&&<div className="storage-banner" role="alert"><CircleAlert size={16}/><span>{storageWarning}</span>{!autosave&&<button onClick={()=>{if(externalChange){const fresh=loadWorkspace();if(fresh.warning){setStorageWarning(fresh.warning);return;}if(fresh.documents.length){setDocuments(fresh.documents);setActiveId(fresh.activeId||fresh.documents[0].id);}else{const doc=createDocument();setDocuments([doc]);setActiveId(doc.id);}setExternalChange(false);}setAutosave(true);setStorageWarning('');}}>{externalChange?'Reload workspace':'Resume autosave'}</button>}<button onClick={downloadProject}>Download project</button></div>}
      <div className="workspace-toolbar"><div className="workspace-path"><button className="icon-button desktop-only" title={sourceVisible?'Hide source':'Show source'} aria-label={sourceVisible?'Hide source panel':'Show source panel'} onClick={()=>setSourceVisible(v=>!v)}>{sourceVisible?<PanelLeftClose size={16}/>:<PanelLeftOpen size={16}/>}</button><span>Workspace</span><ChevronRight size={13}/><strong>{document.title}</strong></div><div className="workspace-tools"><span className="engine-label">Mermaid 12</span><button className="icon-button" onClick={()=>setDialog('help')} aria-label="Open guide" title="Guide & shortcuts"><HelpCircle size={17}/></button><button className={`icon-button desktop-only ${inspectorVisible?'active':''}`} onClick={()=>setInspectorVisible(v=>!v)} aria-label={inspectorVisible?'Hide style panel':'Show style panel'} title="Style panel"><Settings2 size={17}/></button></div></div>
    </>}
    <main className={`workspace mobile-${tab}`}>
      {!present&&<aside className="source-panel" aria-label="Source editor"><div className="panel-heading"><div><Code2 size={16}/><strong>Source</strong><span className="language-badge">.mmd</span></div><button className={`live-button ${live?'on':''}`} onClick={()=>setLive(v=>!v)} aria-pressed={live} title="Toggle live rendering"><span/>{live?'Live':'Paused'}</button></div>
        <div className="source-intro"><p>A little code. A clearer picture.</p><button onClick={()=>setDialog('examples')}>Start from an example<ChevronRight size={13}/></button></div>
        <div className="editor-wrap"><SourceEditor key={document.id} source={document.source} onChange={source=>{if(source.length<=100000)updateDocument({source});else notify('Source is limited to 100,000 characters.');}}/></div>
        {renderError&&<section className="source-error" role="alert"><div><CircleAlert size={16}/><strong>Check your syntax</strong></div><pre>{renderError}</pre><p>{renderResult?'The canvas is keeping your last valid diagram.':'Your source is safe. Fix the error to render it.'}</p></section>}
        <div className="source-actions"><button className="button quiet" onClick={copySource} title="Copy Mermaid source"><Copy size={14}/><span>Copy</span></button><button className="button quiet" onClick={()=>fileInput.current?.click()} title="Import Mermaid or a saved project"><Upload size={14}/><span>Import</span></button><button className="icon-button" aria-label="Render now" title="Render now (Ctrl/⌘ Enter)" onClick={()=>setRenderKey(v=>v+1)}><RefreshCw size={14} className={rendering?'spin':''}/></button></div>
        <div className="source-footer"><span>{document.source.split('\n').length} lines</span><span><kbd>⌘ / Ctrl</kbd> <kbd>↵</kbd> render</span></div>
      </aside>}
      <section className="canvas-panel" aria-label="Diagram canvas">
        <DiagramStage result={renderResult} document={stale&&renderedDocument?{...renderedDocument,title:document.title,subtitle:document.subtitle}:document} selectedKey={selectedKey} onSelect={setSelectedKey} replayKey={replayKey} present={present} motionPaused={motionPaused||reducedMotion} fitRequest={fitRequest}/>
        {(renderError||stale&&!rendering||rendering)&&<div className={`render-status ${renderError?'error':''}`} role="status">{rendering?<><LoaderCircle size={14} className="spin"/>Rendering diagram</>:renderError?<><CircleAlert size={14}/>{renderResult?'Showing last valid diagram':'Source needs a correction'}</>:<><Pause size={14}/>Canvas paused · Render to update</>}</div>}
        {renderResult?.warnings.length ? <details className="render-notes"><summary><CircleAlert size={13}/>{renderResult.warnings.length} rendering {renderResult.warnings.length===1?'note':'notes'}</summary><ul>{renderResult.warnings.map(w=><li key={w}>{w}</li>)}</ul></details>:null}
      </section>
      {!present&&<aside className="inspector-panel" aria-label="Diagram styling"><div className="panel-heading"><div><Settings2 size={16}/><strong>Make it yours</strong></div><button className="icon-button" onClick={()=>{updateSettings({...DEFAULT_SETTINGS});updateDocument({nodeAccents:{}});notify('Style reset to the Meridian defaults.');}} title="Reset all styling" aria-label="Reset all styling"><RotateCcw size={15}/></button></div><Inspector document={document} onSettings={updateSettings} onDocument={updateDocument} selectedNode={selectedNode} onAccent={color=>{if(!selectedKey)return;const nodeAccents={...document.nodeAccents};if(color)nodeAccents[selectedKey]=color;else delete nodeAccents[selectedKey];updateDocument({nodeAccents});}} onClearSelection={()=>setSelectedKey(null)} onReplay={()=>setReplayKey(v=>v+1)} reducedMotion={reducedMotion}/></aside>}
    </main>
    {!present&&<><footer className="status-bar"><span><ShieldCheck size={13}/>Made here. Stays here.<span className="status-sub"> Your diagrams stay in your browser.</span></span><div>{renderResult&&<><span>{renderResult.diagramType.replace(/[-_]/g,' ')}</span>{renderResult.nodes.length>0&&<span>{renderResult.nodes.length} nodes</span>}{renderResult.edgeCount>0&&<span>{renderResult.edgeCount} connections</span>}</>}<button onClick={()=>setDialog('help')}>Guide & shortcuts<BookOpen size={12}/></button></div></footer><nav className="mobile-nav" aria-label="Workspace panels">{([['canvas',Scan,'Canvas'],['source',Code2,'Source'],['style',Settings2,'Style']] as const).map(([id,Icon,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)} aria-current={tab===id?'page':undefined}><Icon size={19}/>{label}</button>)}</nav></>}
    {present&&<div className="presentation-controls"><span className="presentation-label">Meridian <span>Presentation</span></span><button onClick={()=>setMotionPaused(p=>!p)} aria-pressed={motionPaused} title={motionPaused?'Resume animation':'Pause animation'}>{motionPaused?<Play size={17}/>:<Pause size={17}/>}<span>{motionPaused?'Play':'Pause'}</span></button><button onClick={()=>setReplayKey(v=>v+1)}><RotateCcw size={16}/><span>Replay</span></button><button onClick={()=>setFitRequest(v=>v+1)}><Maximize2 size={16}/><span>Fit</span></button><span className="control-separator"/><button onClick={()=>setPresent(false)}><X size={17}/><span>Exit <kbd>Esc</kbd></span></button></div>}

    {dialog==='examples'&&<Modal title="Start with a good idea." eyebrow="THE EXAMPLE COLLECTION" wide onClose={()=>setDialog(null)}><p className="modal-intro">Real Mermaid. A considered starting point. Every example opens as a new project.</p><div className="filter-chips">{categories.map(c=><button key={c} className={c===exampleCategory?'selected':''} onClick={()=>setExampleCategory(c)}>{c}</button>)}</div><div className="example-grid">{TEMPLATES.filter(t=>exampleCategory==='All'||t.category===exampleCategory).map((t,index)=><button key={t.id} className="example-card" onClick={()=>createProject(t)} style={{'--example-accent':getTheme(t.theme).accent,'--example-background':getTheme(t.theme).canvas} as CSSProperties}><div className="example-art" aria-hidden="true"><svg viewBox="0 0 240 105"><path d={index%2?'M48 52H100M140 52H192M120 32V12M120 72V94':'M65 30H120V72H179M65 30H179'} fill="none" stroke="currentColor" strokeWidth="1.3" opacity=".45"/><rect x="25" y={index%2?36:14} width="55" height="32" rx="6"/><rect x="95" y="36" width="55" height="32" rx="6"/><rect x="165" y={index%2?36:56} width="55" height="32" rx="6"/><path d="M39 26h25m-25 6h17M109 48h25m-25 6h17M179 68h25" stroke="currentColor" strokeWidth="2" opacity=".5"/></svg><span>{t.category}</span></div><div className="example-copy"><h3>{t.title}</h3><p>{t.description}</p><span>Use this example<Plus size={14}/></span></div></button>)}</div></Modal>}

    {dialog==='projects'&&<Modal title="Your workspace" eyebrow="SAVED IN THIS BROWSER" wide onClose={()=>{setDialog(null);setPendingDelete(null);}}><div className="project-toolbar"><p>Pick up where you left off.</p><button className="button secondary" onClick={()=>fileInput.current?.click()}><Upload size={15}/>Import</button><button className="button primary" onClick={()=>createProject()}><Plus size={16}/>New diagram</button></div><div className="project-list">{[...documents].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(d=><div key={d.id} className={`project-row ${activeId===d.id?'current':''}`}><button className="project-open" onClick={()=>{setActiveId(d.id);setDialog(null);setLive(true);}}><span className="project-icon" style={{color:getTheme(d.settings.theme).accent,background:getTheme(d.settings.theme).canvas}}><Layers3 size={22}/></span><span><strong>{d.title}</strong><small>{getTheme(d.settings.theme).name} · {new Date(d.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}{d.id===activeId?' · Open':''}</small></span></button><button className="icon-button danger" aria-label={`Delete ${d.title}`} onClick={()=>setPendingDelete(d.id)}><Trash2 size={16}/></button></div>)}</div>{pendingDelete&&<div className="delete-confirm" role="alert"><p>Remove “{documents.find(d=>d.id===pendingDelete)?.title}” from this browser? Download a copy first if you need it.</p><button className="button quiet" onClick={()=>setPendingDelete(null)}>Keep it</button><button className="button danger-button" onClick={removeProject}>Remove project</button></div>}<div className="project-modal-footer"><button className="button quiet" onClick={copyProject}><Copy size={15}/>Duplicate current</button><button className="button quiet" onClick={downloadProject}><Download size={15}/>Download current</button><span>{documents.length} / 50 projects</span></div><p className="muted-note">Browser data is local to this device and website. Download .meridian.json projects for backups or to move work between browsers.</p></Modal>}

    {dialog==='export'&&<Modal title="Take your diagram with you." eyebrow="EXPORT" onClose={()=>{if(!exportBusy)setDialog(null);}}><div className="export-format-grid">{([
      ['png',FileImage,'PNG','Slide-ready image'],['svg',Frame,'SVG','Scalable vector'],['html',FileCode2,'HTML','Animated presentation'],['project',FileJson,'Project','Source + all styling'],['source',Code2,'Mermaid','Plain .mmd source']
    ] as const).map(([format,Icon,label,description])=><button key={format} className={`export-format ${format===exportFormat?'selected':''}`} onClick={()=>{setExportFormat(format);setExportError('');}} aria-pressed={format===exportFormat}><Icon size={22}/><span><strong>{label}</strong><small>{description}</small></span>{format===exportFormat&&<Check size={17}/>}</button>)}</div>
      {visualExport&&<div className="export-options">{exportFormat==='png'&&<label>Resolution<select value={exportScale} onChange={e=>setExportScale(Number(e.target.value))}><option value={1}>1× · Standard</option><option value={2}>2× · Crisp</option><option value={4}>4× · Large format</option></select></label>}<label className="check-label"><input type="checkbox" checked={exportFrame} onChange={e=>setExportFrame(e.target.checked)}/><span>Include presentation frame<small>Title, spacing, and your stage settings</small></span></label><label className="check-label"><input type="checkbox" checked={exportTransparent} onChange={e=>setExportTransparent(e.target.checked)}/><span>Transparent background<small>Keep the current text and node colors</small></span></label><p className="muted-note">{exportFormat==='html'?'One self-contained file with animation, pause controls, and no internet requirement.':'SVG and PNG are still images. Use HTML to keep the motion in a browser.'}</p></div>}
      {visualExport&&(stale||renderError||!renderResult)&&<p className="inline-error"><CircleAlert size={16}/>Render the current source successfully to export the picture. Source and project downloads are always available.</p>}
      {exportError&&<p className="inline-error" role="alert"><CircleAlert size={16}/>{exportError}</p>}
      <div className="export-bottom"><span>{document.title}</span><button className="button primary" disabled={exportBusy||(visualExport&&(stale||!!renderError||!renderResult))} onClick={doExport}>{exportBusy?<LoaderCircle className="spin" size={16}/>:<Download size={16}/>}Download {exportFormat==='project'?'project':exportFormat.toUpperCase()}</button></div>
    </Modal>}

    {dialog==='help'&&<Modal title="From syntax to stage." eyebrow="THE MERIDIAN GUIDE" wide onClose={()=>setDialog(null)}><div className="guide-grid"><section><h3><Code2 size={19}/>Write or paste Mermaid</h3><p>Edit the source or import an .mmd file. Rendering updates as you type. When the syntax is incomplete, the canvas holds the last good picture.</p><pre className="guide-code">{'flowchart LR\n  A[An idea] --> B{A decision}\n  B -->|Yes| C[Make it happen]\n  B -->|Not yet| A'}</pre><p>Mermaid source stays intact when you change the look. Configuration directives are ignored so your studio settings remain in control.</p></section><section><h3><Sparkles size={19}/>Give it a visual language</h3><p>Choose a theme, then refine surfaces, shadows, connections, and motion. Click a supported node to give it an accent or spotlight it.</p><p>Flow effects follow diagram connections. They are presentation effects, not live traffic. Some diagram types have their own geometry and only use the shared theme and export controls.</p></section><section><h3><Play size={19}/>Present with purpose</h3><p>Present hides the editing panels. Drag the background to pan, scroll to zoom, and use Fit to reset the view. Replay gives your diagram a fresh entrance.</p><p>Reduced-motion preferences are respected. Turn motion off for a completely still diagram.</p></section><section><h3><Save size={19}/>Keep a portable copy</h3><p>Projects autosave in this browser. Download a Meridian project to preserve the code, palette, effects, and stage settings together.</p><p>Export PNG for slides, SVG for vector artwork, or a self-contained HTML presentation for motion. No account or upload is needed.</p></section></div><div className="shortcut-grid"><span><kbd>Ctrl / ⌘ S</kbd>Download project</span><span><kbd>Ctrl / ⌘ Enter</kbd>Render now</span><span><kbd>F</kbd>Fit diagram</span><span><kbd>P</kbd>Toggle presentation</span><span><kbd>Esc</kbd>Exit presentation</span><span><kbd>Ctrl / ⌘ Z</kbd>Undo in the editor</span></div><p className="guide-footnote">Meridian by ArbiterForge · Built with React and Mermaid 12.3.0 · <a href="https://mermaid.js.org/intro/" target="_blank" rel="noreferrer">Mermaid syntax reference</a></p></Modal>}
    {toast&&<div className="toast" role="status"><Check size={17}/><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={()=>setToast('')}><X size={14}/></button></div>}
  </div>;
}

export default App;

import React, { useState, useMemo } from 'react';
import {
  X, ShieldCheck, ShieldAlert, AlertTriangle, ChevronRight, ChevronDown,
  Copy, Check, Crosshair, Info,
} from 'lucide-react';
import { PanelResizeHandle, PanelWidthPresets } from './PanelResize';
import { summarizeAudit, formatAuditLines, SEVERITY } from './idAudit';

/**
 * Data Health panel - the visible face of the project-wide id audit (Bug 19).
 *
 * ---------------------------------------------------------------------------
 * Why this panel exists
 * ---------------------------------------------------------------------------
 * The checks themselves already existed, but only in a command-line script that
 * needs a terminal and an exported file. The owner of this project has neither,
 * so in practice the most important check in the codebase could never be run by
 * the person who needed it. Everything here is a presentation of findings that
 * `src/idAudit.js` produced; this file contains no detection logic of its own.
 *
 * ---------------------------------------------------------------------------
 * Two deliberate constraints
 * ---------------------------------------------------------------------------
 * 1. READ-ONLY, ALWAYS. Nothing in this panel writes, repairs or renumbers
 *    anything. Automatic bulk renumbering is exactly the kind of silent rewrite
 *    that caused the original data loss, and a diagnostic that can damage data
 *    is not a diagnostic. Because it only reads, it is also safe to open in a
 *    read-only Reference tab.
 * 2. PLAIN LANGUAGE. Every section says what the finding means and whether it
 *    can still cost you work, because a warning nobody understands gets
 *    dismissed. Severity is graded honestly for the same reason: duplicate ids
 *    are red because they used to destroy work; a broken connection line is
 *    amber because it is untidy but harmless.
 */

const TONE = {
  [SEVERITY.OK]: {
    box: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    icon: 'text-emerald-600',
    Icon: ShieldCheck,
  },
  [SEVERITY.WARNING]: {
    box: 'bg-amber-50 border-amber-200 text-amber-900',
    icon: 'text-amber-600',
    Icon: AlertTriangle,
  },
  [SEVERITY.CRITICAL]: {
    box: 'bg-red-50 border-red-200 text-red-900',
    icon: 'text-red-600',
    Icon: ShieldAlert,
  },
};

/** A collapsible findings section. Opens itself when it has something to say. */
function Section({ title, count, severity = 'warning', explanation, children, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen ?? count > 0);
  const empty = count === 0;
  const countTone = empty
    ? 'bg-slate-100 text-slate-500'
    : severity === 'critical'
      ? 'bg-red-100 text-red-700'
      : 'bg-amber-100 text-amber-700';

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
        <span className="text-xs font-semibold text-slate-700 flex-1 min-w-0">{title}</span>
        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded tabular-nums shrink-0 ${countTone}`}>{count}</span>
      </button>
      {open && (
        <div className="px-3 py-2.5 space-y-2 bg-white">
          {explanation && (
            <p className="text-[11px] leading-relaxed text-slate-500">{explanation}</p>
          )}
          {empty
            ? <p className="text-xs text-slate-400 italic">Nothing found.</p>
            : <div className="space-y-1.5">{children}</div>}
        </div>
      )}
    </div>
  );
}

/** One finding. `onReveal` is omitted when there is nothing specific to jump to. */
function Finding({ label, detail, onReveal, revealTitle = 'Show me this on the canvas' }) {
  return (
    <div className="flex items-start gap-2 text-xs bg-slate-50 rounded-md px-2 py-1.5">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-slate-700 break-words">{label}</div>
        {detail && <div className="text-[11px] text-slate-500 break-words mt-0.5">{detail}</div>}
      </div>
      {onReveal && (
        <button
          onClick={onReveal}
          className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors shrink-0"
          title={revealTitle}
        >
          <Crosshair className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export default function DataHealthPanel({
  className = '',
  report,
  projectName = 'This project',
  lastCheckedAt = null,
  onClose,
  onReveal,
  panelWidthPct = 40,
  onSetPanelWidth,
}) {
  const [copied, setCopied] = useState(false);

  const reportText = useMemo(
    () => (report ? formatAuditLines(report, { projectName }).join('\n') : ''),
    [report, projectName],
  );

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused (permissions, or a non-secure origin).
      // Falling back to a selectable prompt beats failing silently.
      window.prompt('Copy the report with Ctrl+C:', reportText.slice(0, 2000));
    }
  };

  if (!report) {
    return (
      <div
        className={`relative bg-white border-l border-slate-200 flex flex-col overflow-hidden shrink-0 ${className}`}
        style={{ width: `${panelWidthPct}%`, minWidth: 320 }}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50">
          <h3 className="text-sm font-bold text-slate-800">Data Health</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="p-4 text-xs text-slate-500">Checking your project...</p>
      </div>
    );
  }

  const tone = TONE[report.severity] || TONE[SEVERITY.WARNING];
  const ToneIcon = tone.Icon;
  const headline = report.severity === SEVERITY.OK
    ? 'No problems found'
    : report.severity === SEVERITY.CRITICAL
      ? 'Duplicate card IDs found'
      : 'Minor problems found';

  const canvasCount = report.totals.canvases;
  const cardCount = report.totals.cards;

  return (
    <div
      className={`relative bg-white border-l border-slate-200 flex flex-col overflow-hidden shrink-0 ${className}`}
      style={{ width: `${panelWidthPct}%`, minWidth: 320 }}
    >
      {onSetPanelWidth && <PanelResizeHandle onChange={onSetPanelWidth} />}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <ToneIcon className={`w-4 h-4 shrink-0 ${tone.icon}`} />
          <h3 className="text-sm font-bold text-slate-800">Data Health</h3>
          {report.problemCount > 0 && (
            <span className="text-xs text-slate-400 font-medium">({report.problemCount})</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onSetPanelWidth && (
            <PanelWidthPresets widthPct={panelWidthPct} onChange={onSetPanelWidth} className="mr-1" />
          )}
          <button
            onClick={copyReport}
            className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-500 hover:text-slate-700 transition-colors"
            title="Copy the full report as text (useful for pasting into a bug report)"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Verdict */}
        <div className={`border rounded-lg p-3 ${tone.box}`}>
          <div className="flex items-center gap-2">
            <ToneIcon className={`w-4 h-4 shrink-0 ${tone.icon}`} />
            <span className="text-sm font-bold">{headline}</span>
          </div>
          <p className="text-xs mt-1.5 leading-relaxed">{summarizeAudit(report)}</p>
          <p className="text-[11px] mt-2 opacity-75">
            Checked all {canvasCount} canvas{canvasCount === 1 ? '' : 'es'} and {cardCount} card{cardCount === 1 ? '' : 's'} in this project
            {lastCheckedAt ? ` at ${lastCheckedAt}` : ''}.
          </p>
        </div>

        {/* 1. Cross-canvas duplicates */}
        <Section
          title="Same card ID on more than one canvas"
          count={report.crossCanvas.length}
          severity="critical"
          explanation="This is the condition behind the original data loss: editing one of these cards used to rewrite the others too, on canvases you were not even looking at, and then save the damage. Edits are now confined to the canvas you are on, so these are no longer dangerous - but they are still wrong, and any clone linked to one of these IDs is ambiguous."
        >
          {report.crossCanvas.map(dup => (
            <div key={`cross-${dup.id}`} className="bg-slate-50 rounded-md px-2 py-1.5">
              <div className="text-xs font-medium text-slate-700">
                ID <span className="font-mono bg-red-100 text-red-700 px-1 rounded">{dup.id}</span>
                {' '}is used by {dup.totalCards} cards on {dup.places.length} canvases:
              </div>
              <div className="mt-1 space-y-1">
                {dup.places.map((place, i) => (
                  <div key={`${dup.id}-${place.workspaceId || i}`} className="flex items-center gap-2 text-[11px] text-slate-600">
                    <span className="flex-1 min-w-0 truncate">
                      {place.workspaceName}
                      {place.count > 1 && <span className="text-red-600 font-semibold"> ({place.count} cards here)</span>}
                    </span>
                    {onReveal && place.workspaceId && (
                      <button
                        onClick={() => onReveal({ workspaceId: place.workspaceId, cardId: dup.id })}
                        className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors shrink-0"
                        title={`Go to this card on ${place.workspaceName}`}
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Section>

        {/* 2. Within-canvas duplicates */}
        <Section
          title="Same card ID twice on one canvas"
          count={report.withinCanvas.length}
          severity="critical"
          explanation="Two cards on the same canvas share one ID, so the app cannot tell them apart. They behave as a single object: they move together, share connections, and cannot be deleted independently. This can also make cards appear to linger on screen after you switch canvases, because the display cannot distinguish them either."
        >
          {report.withinCanvas.map((dup, i) => (
            <Finding
              key={`within-${dup.id}-${dup.workspaceId || i}`}
              label={`ID ${dup.id} - ${dup.count} cards on "${dup.workspaceName}"`}
              detail="Both cards claim the same identity."
              onReveal={onReveal && dup.workspaceId ? () => onReveal({ workspaceId: dup.workspaceId, cardId: dup.id }) : undefined}
            />
          ))}
        </Section>

        {/* 3. Counter */}
        <Section
          title="Card ID counter"
          count={report.counter.clashes.length}
          explanation="New cards are numbered from a stored counter. If that counter falls behind the cards already in the project, it would hand out IDs that are already taken. The app now takes the highest ID actually in use as a floor before allocating, so this cannot create new duplicates - it is reported because the stored value is still wrong."
        >
          <div className="text-[11px] text-slate-600 bg-slate-50 rounded-md px-2 py-1.5 space-y-0.5">
            <div>Stored counter: <span className="font-mono">{report.counter.storedNextId ?? '(missing)'}</span></div>
            <div>Highest ID actually in use: <span className="font-mono">{report.counter.highest}</span></div>
            <div>ID the next new card will actually get: <span className="font-mono font-semibold text-emerald-700">{report.counter.safeNextId}</span></div>
          </div>
          {report.counter.clashes.length > 0 && (
            <Finding
              label={`The stored counter is at or below ${report.counter.clashes.length} ID${report.counter.clashes.length > 1 ? 's' : ''} already in use.`}
              detail={`Affected IDs: ${report.counter.clashes.slice(0, 40).join(', ')}${report.counter.clashes.length > 40 ? ', ...' : ''}. Contained by the live-data floor - no new card can be born on one of these.`}
            />
          )}
        </Section>

        {/* 4. Clone links */}
        <Section
          title="Clone links that do not resolve"
          count={report.cloneRefs.problems.length}
          explanation="A clone stays linked to its original: editing the title or content of either updates both. If the original is missing, the link is dead. If the original's ID is ambiguous because it is duplicated, the clone will sync with whichever copy the app finds first - which is how an edit ends up on a card you did not mean to touch."
        >
          {report.cloneRefs.problems.map((problem, i) => (
            <Finding
              key={`clone-${problem.nodeId}-${i}`}
              label={problem.kind === 'missing'
                ? `Card ${problem.nodeId} on "${problem.workspaceName}" is linked to a card that no longer exists.`
                : `Card ${problem.nodeId} on "${problem.workspaceName}" has an ambiguous link.`}
              detail={problem.kind === 'missing'
                ? `It points at ID ${problem.sourceId}, which is not in this project.`
                : `It points at ID ${problem.sourceId}, and ${problem.candidates} different cards have that ID.`}
              onReveal={onReveal && problem.workspaceId ? () => onReveal({ workspaceId: problem.workspaceId, cardId: problem.nodeId }) : undefined}
            />
          ))}
        </Section>

        {/* 5. Broken edges */}
        <Section
          title="Connections with a missing end"
          count={report.brokenEdges.length}
          explanation="A connection line whose start or end no longer exists, usually left behind when something was deleted. Harmless to your content - it just cannot be drawn."
        >
          {report.brokenEdges.map((edge, i) => (
            <Finding
              key={`edge-${edge.edgeId}-${edge.endpoint}-${i}`}
              label={edge.kind === 'malformed'
                ? `"${edge.workspaceName}" has a connection entry that is empty.`
                : edge.kind === 'empty'
                  ? `A connection on "${edge.workspaceName}" has no ${edge.endpoint === 'source' ? 'starting point' : 'end point'}.`
                  : `A connection on "${edge.workspaceName}" points at something that no longer exists.`}
              detail={edge.kind === 'missing' ? `Its ${edge.endpoint === 'source' ? 'start' : 'end'} is ID ${edge.value}, which is not on that canvas.` : null}
              onReveal={onReveal && edge.workspaceId ? () => onReveal({ workspaceId: edge.workspaceId }) : undefined}
              revealTitle="Go to this canvas"
            />
          ))}
        </Section>

        {/* 6. Orphaned group members */}
        <Section
          title="Items filed under a group that no longer exists"
          count={report.orphanGroupMembers.length}
          explanation="The item still remembers being in a group that has been deleted. Cosmetic, but it can make group selection and layout behave oddly."
        >
          {report.orphanGroupMembers.map((orphan, i) => (
            <Finding
              key={`orphan-${orphan.objectId}-${i}`}
              label={`${orphan.kind === 'nodes' ? 'Card' : orphan.kind === 'groups' ? 'Group' : 'Image'} ${orphan.objectId} on "${orphan.workspaceName}"`}
              detail={`Still filed under missing group ${orphan.groupId}.`}
              onReveal={onReveal && orphan.workspaceId
                ? () => onReveal({ workspaceId: orphan.workspaceId, cardId: orphan.kind === 'nodes' ? orphan.objectId : undefined })
                : undefined}
            />
          ))}
        </Section>

        {/* 7. Unreadable data */}
        <Section
          title="Data that could not be read"
          count={report.anomalies.length}
          explanation="Parts of the project that are not in the shape the app expects, so the check skipped them. These are listed rather than ignored: a checker that silently passes over damaged data looks exactly like a clean result."
        >
          {report.anomalies.map((anomaly, i) => (
            <Finding
              key={`anomaly-${i}`}
              label={anomaly.workspaceName ? `"${anomaly.workspaceName}"` : 'Project'}
              detail={anomaly.message}
              onReveal={onReveal && anomaly.workspaceId ? () => onReveal({ workspaceId: anomaly.workspaceId }) : undefined}
              revealTitle="Go to this canvas"
            />
          ))}
        </Section>

        {/* Standing reassurance - this panel is incapable of changing anything. */}
        <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
          <p className="leading-relaxed">
            This panel only reads your project. It never changes, repairs or renumbers anything,
            so it is safe to open at any time - including in a read-only Reference tab.
            Fixing a duplicate ID means deliberately editing or recreating the card yourself.
          </p>
        </div>
      </div>
    </div>
  );
}

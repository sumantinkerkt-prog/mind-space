import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, X, Pencil, Check, FolderOpen, Settings, Copy } from 'lucide-react';

/**
 * WorkspaceManager - A dedicated modal for workspace structure management.
 *
 * ARCHITECTURAL ROLE:
 * This component is the ONLY place where workspace structure can be modified
 * (create, rename, delete). By isolating workspace management here, we ensure
 * that canvas editing never triggers project metadata updates. Project metadata
 * (which includes workspaceIds) is only modified through intentional actions
 * performed within this modal.
 *
 * Props:
 * - workspaces: Array of workspace objects
 * - activeTab: Currently active workspace ID
 * - onCreateWorkspace: (name) => void - Creates a new workspace with the given name
 * - onRenameWorkspace: (id, newName) => void - Renames a workspace
 * - onDeleteWorkspace: (id) => void - Deletes a workspace
 * - onDuplicateWorkspace: (id) => void - Duplicates a workspace
 * - onSwitchWorkspace: (id) => void - Switches to a workspace
 * - onClose: () => void - Closes the modal
 * - isPreviewMode: boolean - Whether in preview/reference mode
 */
export default function WorkspaceManager({
  workspaces,
  activeTab,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onDuplicateWorkspace,
  onSwitchWorkspace,
  onClose,
  isPreviewMode
}) {
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [highlightLast, setHighlightLast] = useState(false);
  const listRef = useRef(null);
  const prevCountRef = useRef(workspaces.length);

  // When a workspace is added (via create or duplicate), scroll it into view and
  // briefly highlight it so the user can see where the new workspace landed.
  useEffect(() => {
    if (workspaces.length > prevCountRef.current) {
      setHighlightLast(true);
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      });
      const t = setTimeout(() => setHighlightLast(false), 1600);
      prevCountRef.current = workspaces.length;
      return () => clearTimeout(t);
    }
    prevCountRef.current = workspaces.length;
  }, [workspaces.length]);

  const startCreate = () => {
    setNewName(`Map Phase ${workspaces.length + 1}`);
    setIsCreating(true);
  };

  const commitCreate = () => {
    // Empty-name guard: fall back to a sensible default so a blank-named
    // workspace can never be created.
    const name = newName.trim() || `Map Phase ${workspaces.length + 1}`;
    onCreateWorkspace(name);
    setIsCreating(false);
    setNewName('');
  };

  const cancelCreate = () => {
    setIsCreating(false);
    setNewName('');
  };

  const startRename = (ws) => {
    setEditingId(ws.id);
    setEditingName(ws.name || '');
  };

  const commitRename = () => {
    if (editingId && editingName.trim()) {
      onRenameWorkspace(editingId, editingName.trim());
    }
    setEditingId(null);
    setEditingName('');
  };

  const handleDelete = (id) => {
    if (workspaces.length <= 1) return;
    onDeleteWorkspace(id);
    setConfirmDeleteId(null);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[500] bg-slate-900/60 backdrop-blur-sm animate-backdrop-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[501] flex items-center justify-center pointer-events-none p-4">
        <div
          className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[80vh] flex flex-col pointer-events-auto animate-modal-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-50 rounded-xl">
                <Settings className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Workspace Manager</h2>
                <p className="text-xs text-slate-400 mt-0.5">Create, rename, and delete workspaces</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Workspace List */}
          <div ref={listRef} className="flex-1 overflow-y-auto p-5 space-y-2">
            {workspaces.map((ws, idx) => (
              <div
                key={ws.id}
                className={`group flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  activeTab === ws.id
                    ? 'bg-indigo-50/60 border-indigo-200 shadow-sm'
                    : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                } ${highlightLast && idx === workspaces.length - 1 ? 'ring-2 ring-indigo-400 ring-offset-1' : ''}`}
              >
                {/* Icon */}
                <div className={`p-1.5 rounded-lg ${
                  activeTab === ws.id ? 'bg-indigo-100' : 'bg-slate-100'
                }`}>
                  <FolderOpen className={`w-4 h-4 ${
                    activeTab === ws.id ? 'text-indigo-600' : 'text-slate-400'
                  }`} />
                </div>

                {/* Name (editable or display) */}
                <div className="flex-1 min-w-0">
                  {editingId === ws.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') { setEditingId(null); setEditingName(''); }
                        }}
                        onBlur={commitRename}
                        className="flex-1 px-2 py-1 text-sm font-medium border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                      />
                      <button
                        onClick={commitRename}
                        className="p-1 text-indigo-600 hover:bg-indigo-100 rounded-md transition-colors"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-medium truncate cursor-pointer ${
                          activeTab === ws.id ? 'text-indigo-900' : 'text-slate-700'
                        }`}
                        onClick={() => { onSwitchWorkspace(ws.id); onClose(); }}
                        title="Click to switch to this workspace"
                      >
                        {ws.name || 'Untitled'}
                      </span>
                      {activeTab === ws.id && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-indigo-200/60 text-indigo-700 rounded-full">
                          Active
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                {!isPreviewMode && editingId !== ws.id && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startRename(ws)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                      title="Rename workspace"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {onDuplicateWorkspace && (
                      <button
                        onClick={() => onDuplicateWorkspace(ws.id)}
                        className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors"
                        title="Duplicate workspace"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {workspaces.length > 1 && (
                      confirmDeleteId === ws.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(ws.id)}
                            className="px-2 py-1 text-[10px] font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(ws.id)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                          title="Delete workspace"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Inline "name-before-create" row. The user names the workspace
                first; on confirm it is added to the list above (not opened),
                and they click it to open. */}
            {isCreating && (
              <div className="flex items-center gap-3 p-3 rounded-xl border border-indigo-300 bg-indigo-50/50">
                <div className="p-1.5 rounded-lg bg-indigo-100">
                  <FolderOpen className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={newName}
                    placeholder="Workspace name"
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitCreate();
                      if (e.key === 'Escape') cancelCreate();
                    }}
                    className="flex-1 min-w-0 px-2 py-1 text-sm font-medium border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                  <button
                    onClick={commitCreate}
                    className="px-3 py-1 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors whitespace-nowrap"
                  >
                    Create
                  </button>
                  <button
                    onClick={cancelCreate}
                    className="px-2 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-5 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''}
            </span>
            {!isPreviewMode && (
              <button
                onClick={startCreate}
                disabled={isCreating}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                New Workspace
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

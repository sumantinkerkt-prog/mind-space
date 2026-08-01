import React, { useState, useMemo, useCallback } from 'react';
import {
  X, MapPin, Eye, EyeOff, Search, Trash2, Pencil,
  ArrowUpDown, Plus, Check, ChevronUp, ChevronDown, ChevronRight,
  ArrowUp, ArrowDown, Layers, Palette, FolderInput, Folder,
} from 'lucide-react';
import { GROUP_COLORS } from './taskConstants';
import { PanelResizeHandle, PanelWidthPresets } from './PanelResize';

const PIN_ICONS = [
  { value: '\u2b50', label: 'Important' },
  { value: '\ud83d\udccc', label: 'Bookmark' },
  { value: '\u2705', label: 'Completed' },
  { value: '\ud83d\udca1', label: 'Idea' },
  { value: '\ud83d\udea9', label: 'Priority' },
  { value: '\u26a0\ufe0f', label: 'Warning' },
  { value: '\u2764\ufe0f', label: 'Personal' },
  { value: '\ud83c\udfaf', label: 'Goal' },
  { value: '\ud83d\udcd6', label: 'Learning' },
  { value: '\ud83d\udd25', label: 'Urgent' },
];

const DEFAULT_PIN_GROUP = 'default';
const TASK_PIN_GROUP = 'task';

// Base groups are always present. They can be recolored / reordered / renamed
// but never deleted. Task-linked pins are auto-assigned to the Task group.
const BASE_GROUP_DEFAULTS = {
  [DEFAULT_PIN_GROUP]: { id: DEFAULT_PIN_GROUP, name: 'General', sortOrder: 0, color: 'slate' },
  [TASK_PIN_GROUP]: { id: TASK_PIN_GROUP, name: 'Task', sortOrder: 1, color: 'indigo' },
};

function getGroupColor(group) {
  const fallback = GROUP_COLORS.find(c => c.id === 'slate') || GROUP_COLORS[0];
  if (!group || !group.color) return fallback;
  return GROUP_COLORS.find(c => c.id === group.color) || fallback;
}


export default function PinPanel({
  className = '',
  workspaces,
  activeTab,
  onNavigateToPin,
  onUpdatePin,
  onDeletePin,
  onToggleVisibility,
  onToggleAllVisibility,
  showPanel,
  onClose,
  tasks = [],
  pinGroups = [],
  onUpdatePinGroups,
  panelWidthPct = 40,
  onSetPanelWidth,
  isPreviewMode = false,
}) {
  // --- State ---
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('name'); // 'name' | 'workspace'
  const [sortDirection, setSortDirection] = useState('asc'); // 'asc' | 'desc'
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editingPinId, setEditingPinId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [editingNote, setEditingNote] = useState('');
  const [editingIcon, setEditingIcon] = useState('');
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [changingGroupForPin, setChangingGroupForPin] = useState(null);
  const [groupFilter, setGroupFilter] = useState('all'); // 'all' | group id
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [renamingGroupId, setRenamingGroupId] = useState(null);
  const [renameGroupValue, setRenameGroupValue] = useState('');
  const [colorPickerGroupId, setColorPickerGroupId] = useState(null);

  if (!showPanel) return null;


  // --- Derived: effective pin groups (always includes default + task) ---
  const effectiveGroups = useMemo(() => {
    const arr = [...(pinGroups || [])];
    [DEFAULT_PIN_GROUP, TASK_PIN_GROUP].forEach(id => {
      if (!arr.find(g => g.id === id)) arr.push({ ...BASE_GROUP_DEFAULTS[id] });
    });
    return arr
      .map((g, i) => ({
        ...g,
        sortOrder: typeof g.sortOrder === 'number' ? g.sortOrder : i,
        color: (g.color && GROUP_COLORS.find(c => c.id === g.color)) ? g.color : (BASE_GROUP_DEFAULTS[g.id]?.color || 'slate'),
      }))
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [pinGroups]);

  // --- Derived: task-linked pin IDs ---
  const taskLinkedPinIds = useMemo(() => {
    const ids = new Set();
    (tasks || []).forEach(t => {
      if (t.locationPinId) ids.add(t.locationPinId);
    });
    return ids;
  }, [tasks]);

  // --- Derived: flat list of all pins with workspace info ---
  const allPins = useMemo(() => {
    const pins = [];
    workspaces.forEach(ws => {
      (ws.pins || []).forEach(pin => {
        // Determine group: task-linked pins go to "task" group
        let groupId = pin.pinGroupId || DEFAULT_PIN_GROUP;
        if (taskLinkedPinIds.has(pin.id)) {
          groupId = TASK_PIN_GROUP;
        }
        // Guard against pins referencing a deleted group
        if (!effectiveGroups.find(g => g.id === groupId)) {
          groupId = DEFAULT_PIN_GROUP;
        }
        pins.push({
          ...pin,
          workspaceId: ws.id,
          workspaceName: ws.name,
          pinGroupId: groupId,
          isTaskLinked: taskLinkedPinIds.has(pin.id),
        });
      });
    });
    return pins;
  }, [workspaces, taskLinkedPinIds, effectiveGroups]);


  // --- Filtering ---
  const filteredPins = useMemo(() => {
    let result = allPins;
    if (groupFilter !== 'all') {
      result = result.filter(p => p.pinGroupId === groupFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.note || '').toLowerCase().includes(q) ||
        p.workspaceName.toLowerCase().includes(q)
      );
    }
    return result;
  }, [allPins, searchQuery, groupFilter]);

  // --- Sorting (applied within each group) ---
  const sortedPins = useMemo(() => {
    const sorted = [...filteredPins];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'workspace') {
        cmp = a.workspaceName.localeCompare(b.workspaceName);
      } else {
        cmp = a.name.localeCompare(b.name);
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredPins, sortField, sortDirection]);

  // --- Group pins by group id ---
  const groupedPins = useMemo(() => {
    const result = {};
    effectiveGroups.forEach(g => { result[g.id] = []; });
    sortedPins.forEach(pin => {
      if (!result[pin.pinGroupId]) result[pin.pinGroupId] = [];
      result[pin.pinGroupId].push(pin);
    });
    return result;
  }, [sortedPins, effectiveGroups]);

  // Groups actually rendered (respects group filter)
  const visibleGroups = useMemo(() => {
    if (groupFilter === 'all') return effectiveGroups;
    return effectiveGroups.filter(g => g.id === groupFilter);
  }, [effectiveGroups, groupFilter]);


  // --- Handlers: sorting ---
  const handleSort = useCallback((field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }, [sortField]);

  // --- Handlers: bulk delete ---
  const toggleDeleteSelection = useCallback((pinId) => {
    setSelectedForDelete(prev => {
      const next = new Set(prev);
      if (next.has(pinId)) next.delete(pinId);
      else next.add(pinId);
      return next;
    });
  }, []);

  const selectAllForDelete = useCallback(() => {
    if (selectedForDelete.size === sortedPins.length) {
      setSelectedForDelete(new Set());
    } else {
      setSelectedForDelete(new Set(sortedPins.map(p => p.id)));
    }
  }, [sortedPins, selectedForDelete.size]);

  const confirmBulkDelete = useCallback(() => {
    selectedForDelete.forEach(pinId => {
      const pin = allPins.find(p => p.id === pinId);
      if (pin) onDeletePin(pinId, pin.workspaceId);
    });
    setSelectedForDelete(new Set());
    setDeleteMode(false);
    setShowDeleteConfirm(false);
  }, [selectedForDelete, allPins, onDeletePin]);

  const cancelDeleteMode = useCallback(() => {
    setDeleteMode(false);
    setSelectedForDelete(new Set());
    setShowDeleteConfirm(false);
  }, []);

  // --- Handlers: pin edit ---
  const startEdit = useCallback((pin) => {
    setEditingPinId(pin.id);
    setEditingName(pin.name);
    setEditingNote(pin.note || '');
    setEditingIcon(pin.icon);
  }, []);

  const commitEdit = useCallback((pinId, workspaceId) => {
    onUpdatePin(pinId, {
      name: editingName.trim() || 'Unnamed Pin',
      note: editingNote,
      icon: editingIcon,
    }, workspaceId);
    setEditingPinId(null);
  }, [editingName, editingNote, editingIcon, onUpdatePin]);

  const cancelEdit = useCallback(() => {
    setEditingPinId(null);
  }, []);

  // --- Handlers: group management (persist full effective list) ---
  const persistGroups = useCallback((groups) => {
    if (onUpdatePinGroups) onUpdatePinGroups(groups);
  }, [onUpdatePinGroups]);

  const toggleGroupCollapse = useCallback((groupId) => {
    setCollapsedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  }, []);

  const addGroup = useCallback(() => {
    if (!newGroupName.trim()) return;
    const maxOrder = Math.max(0, ...effectiveGroups.map(g => g.sortOrder || 0));
    const color = GROUP_COLORS[effectiveGroups.length % GROUP_COLORS.length].id;
    const newGroup = {
      id: `pg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: newGroupName.trim(),
      sortOrder: maxOrder + 1,
      color,
    };
    persistGroups([...effectiveGroups, newGroup]);
    setNewGroupName('');
  }, [newGroupName, effectiveGroups, persistGroups]);

  const renameGroup = useCallback((groupId, name) => {
    if (!name.trim()) { setRenamingGroupId(null); return; }
    persistGroups(effectiveGroups.map(g => g.id === groupId ? { ...g, name: name.trim() } : g));
    setRenamingGroupId(null);
    setRenameGroupValue('');
  }, [effectiveGroups, persistGroups]);

  const updateGroupColor = useCallback((groupId, color) => {
    persistGroups(effectiveGroups.map(g => g.id === groupId ? { ...g, color } : g));
    setColorPickerGroupId(null);
  }, [effectiveGroups, persistGroups]);

  const deleteGroup = useCallback((groupId) => {
    if (groupId === DEFAULT_PIN_GROUP || groupId === TASK_PIN_GROUP) return;
    // Move pins from deleted group to default
    allPins.forEach(pin => {
      if (pin.pinGroupId === groupId && !pin.isTaskLinked) {
        onUpdatePin(pin.id, { pinGroupId: DEFAULT_PIN_GROUP }, pin.workspaceId);
      }
    });
    persistGroups(effectiveGroups.filter(g => g.id !== groupId));
  }, [effectiveGroups, allPins, onUpdatePin, persistGroups]);

  const reorderGroup = useCallback((groupId, direction) => {
    const sorted = [...effectiveGroups].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const idx = sorted.findIndex(g => g.id === groupId);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const reindexed = {};
    sorted.forEach((g, i) => { reindexed[g.id] = i + 1; });
    const targetId = sorted[swapIdx].id;
    const temp = reindexed[groupId];
    reindexed[groupId] = reindexed[targetId];
    reindexed[targetId] = temp;
    persistGroups(sorted.map(g => ({ ...g, sortOrder: reindexed[g.id] })));
  }, [effectiveGroups, persistGroups]);

  const changeGroup = useCallback((pinId, newGroupId, workspaceId) => {
    onUpdatePin(pinId, { pinGroupId: newGroupId }, workspaceId);
    setChangingGroupForPin(null);
  }, [onUpdatePin]);

  const activeWsPins = workspaces.find(ws => ws.id === activeTab)?.pins || [];
  const allVisible = activeWsPins.length > 0 && activeWsPins.every(p => p.visibility_status);

  // --- Sort indicator ---
  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-slate-300" />;
    return sortDirection === 'asc'
      ? <ArrowUp className="w-3 h-3 text-indigo-600" />
      : <ArrowDown className="w-3 h-3 text-indigo-600" />;
  };

  return (
    <div
      className={`relative bg-white border-l border-slate-200 flex flex-col overflow-hidden shrink-0 ${className}`}
      style={{ width: `${panelWidthPct}%`, minWidth: 320 }}
    >
      {/* Resize handle (drag left edge) */}
      {onSetPanelWidth && <PanelResizeHandle onChange={onSetPanelWidth} />}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="w-4 h-4 text-rose-600 shrink-0" />
          <h3 className="text-sm font-bold text-slate-800">Pins</h3>
          <span className="text-xs text-slate-400 font-medium">
            ({allPins.length})
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onSetPanelWidth && (
            <PanelWidthPresets widthPct={panelWidthPct} onChange={onSetPanelWidth} className="mr-1" />
          )}
          <button
            onClick={() => onToggleAllVisibility(!allVisible)}
            className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-500 hover:text-slate-700 transition-colors"
            title={allVisible ? 'Hide All Pins' : 'Show All Pins'}
          >
            {allVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
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


      {/* Toolbar: Search + Actions */}
      <div className="px-3 py-2 border-b border-slate-100 shrink-0 space-y-2">
        <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-2.5 py-1.5">
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search pins..."
            className="flex-1 bg-transparent text-xs text-slate-700 placeholder-slate-400 focus:outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Group filter dropdown */}
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="flex-1 text-[11px] font-medium bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-300"
          >
            <option value="all">All Groups</option>
            {effectiveGroups.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          {/* Sort field toggle */}
          <button
            onClick={() => handleSort(sortField === 'name' ? 'workspace' : 'name')}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md border bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-700 text-[10px] font-semibold transition-colors"
            title="Toggle sort field"
          >
            {sortField === 'name' ? 'Name' : 'Tab'}
            <SortIcon field={sortField} />
          </button>
          {/* Group Manager toggle */}
          <button
            onClick={() => setShowGroupManager(!showGroupManager)}
            className={`p-1.5 rounded-md border transition-colors ${showGroupManager ? 'bg-indigo-50 border-indigo-300 text-indigo-600' : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-700'}`}
            title="Manage Groups"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
          {/* Delete mode toggle */}
          {!isPreviewMode && (
          <button
            onClick={() => { if (deleteMode) cancelDeleteMode(); else setDeleteMode(true); }}
            className={`p-1.5 rounded-md border transition-colors ${deleteMode ? 'bg-red-50 border-red-300 text-red-600' : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-red-500'}`}
            title={deleteMode ? 'Cancel Delete' : 'Bulk Delete'}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          )}
        </div>
      </div>


      {/* Group Manager Panel: add group + list */}
      {showGroupManager && (
        <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/50 shrink-0">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">Manage Pin Groups</span>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="New group name..."
              className="flex-1 text-[11px] bg-white border border-slate-200 rounded-md px-2 py-1.5 text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-300"
              onKeyDown={(e) => { if (e.key === 'Enter') addGroup(); }}
            />
            <button
              onClick={addGroup}
              disabled={!newGroupName.trim()}
              className="px-2.5 py-1.5 text-[10px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">
            Reorder, rename, recolor or delete groups using the controls on each group header below.
          </p>
        </div>
      )}


      {/* Delete Mode: Select All + Confirm */}
      {deleteMode && (
        <div className="px-3 py-2 border-b border-red-100 bg-red-50/50 shrink-0 flex items-center gap-2">
          <button
            onClick={selectAllForDelete}
            className="text-[10px] font-semibold text-red-700 hover:text-red-800 underline transition-colors"
          >
            {selectedForDelete.size === sortedPins.length ? 'Deselect All' : 'Select All'}
          </button>
          <span className="text-[10px] text-red-500 flex-1">
            {selectedForDelete.size} selected
          </span>
          <button
            onClick={() => { if (selectedForDelete.size > 0) setShowDeleteConfirm(true); }}
            disabled={selectedForDelete.size === 0}
            className="px-2.5 py-1 text-[10px] font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Delete ({selectedForDelete.size})
          </button>
        </div>
      )}


      {/* Grouped Body */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {allPins.length === 0 && (
          <p className="text-xs text-slate-400 italic text-center py-6 px-4">
            No pins yet. Right-click on canvas or press Shift+P to add one.
          </p>
        )}

        {allPins.length > 0 && visibleGroups.map(group => {
          const groupPins = groupedPins[group.id] || [];
          const isCollapsed = collapsedGroups[group.id];
          const colorCfg = getGroupColor(group);
          const isBase = group.id === DEFAULT_PIN_GROUP || group.id === TASK_PIN_GROUP;

          return (
            <div key={group.id} className="border-b border-slate-100">
              {/* Group Header */}
              <div className={`flex items-center gap-2 px-3 py-2 border-l-4 ${colorCfg.headerBorder} ${colorCfg.headerBg}`}>
                <button
                  onClick={() => toggleGroupCollapse(group.id)}
                  className="shrink-0 text-slate-500 hover:text-slate-700"
                  title={isCollapsed ? 'Expand' : 'Collapse'}
                >
                  {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {renamingGroupId === group.id ? (
                  <input
                    type="text"
                    value={renameGroupValue}
                    onChange={(e) => setRenameGroupValue(e.target.value)}
                    className="text-sm bg-white border border-slate-200 rounded px-2 py-0.5 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-300 min-w-0 flex-1"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') renameGroup(group.id, renameGroupValue); if (e.key === 'Escape') setRenamingGroupId(null); }}
                    onBlur={() => renameGroup(group.id, renameGroupValue)}
                  />
                ) : (
                  <span className={`text-sm font-semibold truncate ${colorCfg.headerText}`}>{group.name}</span>
                )}
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${colorCfg.badgeBg}`}>
                  {groupPins.length}
                </span>

                {/* Group actions */}
                <div className="flex items-center gap-0.5 ml-auto shrink-0">
                  <button
                    onClick={() => reorderGroup(group.id, 'up')}
                    className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition-colors"
                    title="Move Group Up"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => reorderGroup(group.id, 'down')}
                    className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition-colors"
                    title="Move Group Down"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setColorPickerGroupId(colorPickerGroupId === group.id ? null : group.id)}
                    className={`p-1 rounded transition-colors ${colorPickerGroupId === group.id ? 'bg-slate-200 text-slate-700' : 'text-slate-400 hover:text-slate-600'}`}
                    title="Edit Color"
                  >
                    <Palette className="w-3 h-3" />
                  </button>
                  {colorPickerGroupId === group.id && (
                    <div className="flex items-center gap-0.5">
                      {GROUP_COLORS.map(c => (
                        <button
                          key={c.id}
                          onClick={() => updateGroupColor(group.id, c.id)}
                          className={`w-3 h-3 rounded-full ${c.dotColor} ${group.color === c.id ? 'ring-2 ring-offset-1 ring-slate-400' : ''} hover:scale-125 transition-transform`}
                          title={c.name}
                        />
                      ))}
                    </div>
                  )}
                  {renamingGroupId !== group.id && (
                    <button
                      onClick={() => { setRenamingGroupId(group.id); setRenameGroupValue(group.name); }}
                      className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                      title="Rename Group"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                  {!isBase && (
                    <button
                      onClick={() => deleteGroup(group.id)}
                      className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                      title="Delete Group"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Pin rows */}
              {!isCollapsed && groupPins.length === 0 && (
                <div className="px-4 py-2.5 text-[11px] text-slate-400 italic">
                  {searchQuery || groupFilter !== 'all' ? 'No matching pins' : 'No pins in this group'}
                </div>
              )}

              {!isCollapsed && groupPins.map(pin => {
                if (editingPinId === pin.id) {
                  return (
                    <div key={pin.id} className="px-3 py-2 bg-slate-50 border-b border-slate-100">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="w-full text-xs bg-white border border-slate-200 rounded px-2 py-1 mb-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-rose-300"
                        placeholder="Pin name"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(pin.id, pin.workspaceId); if (e.key === 'Escape') cancelEdit(); }}
                      />
                      <textarea
                        value={editingNote}
                        onChange={(e) => setEditingNote(e.target.value)}
                        className="w-full text-[11px] bg-white border border-slate-200 rounded px-2 py-1 mb-1.5 text-slate-600 placeholder-slate-400 resize-none focus:outline-none focus:ring-1 focus:ring-rose-300"
                        placeholder="Note (optional)"
                        rows={2}
                      />
                      <div className="mb-2">
                        <span className="text-[10px] text-slate-500 font-medium block mb-1">Icon:</span>
                        <div className="flex items-center gap-1 flex-wrap">
                          {PIN_ICONS.map(ic => (
                            <button
                              key={ic.value}
                              onClick={() => setEditingIcon(ic.value)}
                              className={`w-6 h-6 rounded flex items-center justify-center text-sm transition-all ${editingIcon === ic.value ? 'bg-slate-200 ring-1 ring-slate-400' : 'hover:bg-slate-100'}`}
                              title={ic.label}
                            >
                              {ic.value}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => commitEdit(pin.id, pin.workspaceId)} className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-semibold rounded transition-colors">Save</button>
                        <button onClick={cancelEdit} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-semibold rounded transition-colors">Cancel</button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={pin.id}
                    className="flex items-center px-3 py-1.5 hover:bg-slate-50 cursor-pointer group transition-colors border-b border-slate-50"
                    onClick={() => {
                      if (deleteMode) { toggleDeleteSelection(pin.id); return; }
                      onNavigateToPin(pin.id, pin.workspaceId);
                    }}
                    title={pin.note || pin.name}
                  >
                    {/* Checkbox for delete mode */}
                    {deleteMode && (
                      <div className="w-5 shrink-0 flex items-center justify-center">
                        <div
                          className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-colors ${
                            selectedForDelete.has(pin.id)
                              ? 'bg-red-500 border-red-500'
                              : 'border-slate-300 hover:border-red-400'
                          }`}
                        >
                          {selectedForDelete.has(pin.id) && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                      </div>
                    )}

                    {/* Icon + Name (now takes the full freed-up width) */}
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <span className="w-5 h-5 flex items-center justify-center shrink-0 text-sm">
                        {pin.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-medium text-slate-700 truncate block">
                          {pin.name}
                        </span>
                        <span className="text-[9px] font-medium text-slate-400 truncate block">
                          {pin.workspaceName}
                        </span>
                      </div>
                    </div>

                    {/* Change-group dropdown (inline) */}
                    {changingGroupForPin === pin.id && (
                      <select
                        value={pin.pinGroupId}
                        onChange={(e) => changeGroup(pin.id, e.target.value, pin.workspaceId)}
                        onBlur={() => setChangingGroupForPin(null)}
                        autoFocus
                        className="text-[9px] bg-white border border-indigo-300 rounded px-1 py-0.5 text-slate-700 focus:outline-none mr-1 max-w-[110px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {effectiveGroups.map(g => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    )}

                    {/* Actions */}
                    <div className="shrink-0 flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!pin.isTaskLinked && changingGroupForPin !== pin.id && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setChangingGroupForPin(pin.id); }}
                          className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-indigo-600 transition-colors"
                          title="Move to group"
                        >
                          <FolderInput className="w-3 h-3" />
                        </button>
                      )}
                      {pin.isTaskLinked && (
                        <span className="p-0.5 text-indigo-300" title="Auto-grouped (task-linked)">
                          <Folder className="w-3 h-3" />
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleVisibility(pin.id, pin.workspaceId); }}
                        className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                        title={pin.visibility_status ? 'Hide' : 'Show'}
                      >
                        {pin.visibility_status ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(pin); }}
                        className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeletePin(pin.id, pin.workspaceId); }}
                        className="p-0.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>


      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-4 max-w-[280px] w-full mx-4">
            <div className="flex items-center gap-2 mb-3">
              <Trash2 className="w-5 h-5 text-red-500" />
              <h4 className="text-sm font-bold text-slate-800">Confirm Deletion</h4>
            </div>
            <p className="text-xs text-slate-600 mb-4">
              Are you sure you want to delete <strong>{selectedForDelete.size}</strong> pin{selectedForDelete.size > 1 ? 's' : ''}? This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmBulkDelete}
                className="px-3 py-1.5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { PIN_ICONS };

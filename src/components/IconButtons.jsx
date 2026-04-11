/**
 * Shared icon button components used throughout the app.
 *
 * Usage:
 *   import { SaveBtn, CancelBtn, DeleteBtn, EditBtn, AddBtn } from '../components/IconButtons'
 *   import '../components/IconButtons.css'
 *
 *   <EditBtn   onClick={handleEdit}   />          — cyan pencil
 *   <SaveBtn   onClick={handleSave}   disabled={saving} />  — green checkmark
 *   <DeleteBtn onClick={handleDelete} />          — red trashcan
 *   <CancelBtn onClick={handleCancel} />          — muted X (turns red on hover)
 *   <AddBtn    onClick={handleAdd}    />          — yellow plus
 *
 * All buttons are 28×28, radius 8px.
 * Pass className or style props to override if needed.
 */

export function EditBtn({ onClick, className = '', style = {} }) {
  return (
    <button className={`ib-btn ib-edit ${className}`} onClick={onClick} aria-label="Edit" style={style}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    </button>
  )
}

export function SaveBtn({ onClick, disabled, className = '', style = {} }) {
  return (
    <button className={`ib-btn ib-save ${className}`} onClick={onClick} disabled={disabled} aria-label="Save" style={style}>
      {disabled
        ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><circle cx="12" cy="12" r="10"/></svg>
        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
      }
    </button>
  )
}

export function DeleteBtn({ onClick, className = '', style = {} }) {
  return (
    <button className={`ib-btn ib-delete ${className}`} onClick={onClick} aria-label="Delete" style={style}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6M14 11v6"/>
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
      </svg>
    </button>
  )
}

export function CancelBtn({ onClick, className = '', style = {} }) {
  return (
    <button className={`ib-btn ib-cancel ${className}`} onClick={onClick} aria-label="Cancel" style={style}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  )
}

export function AddBtn({ onClick, className = '', style = {} }) {
  return (
    <button className={`ib-btn ib-add ${className}`} onClick={onClick} aria-label="Add" style={style}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>
  )
}

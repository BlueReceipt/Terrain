import { useSignal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { EditWrite } from '../domain/actions.ts';
import { houseNumbers, phoneColumns } from '../domain/calls.ts';
import { editableColumns, editLayout, type LayoutField } from '../domain/editLayout.ts';
import { currentValue } from '../domain/identity.ts';
import type { Row } from '../domain/types.ts';
import {
  answerCall,
  dial,
  dropCall,
  logCallOutcome,
  removeNote,
  saveEdits,
  saveNote,
} from './actions.ts';
import { useDialog } from './dialog.ts';
import { current, settings } from './flow.ts';
import { PinHereButton } from './HouseCard.tsx';
import { sheet, type Sheet } from './mapState.ts';
import { addressOf, nameOf } from './rowText.ts';
import { numberText } from './StatusChip.tsx';
import { strings } from './strings.ts';

function close(): void {
  sheet.value = null;
}

function SheetFrame({ title, children }: { title: string; children: ComponentChildren }) {
  const ref = useDialog<HTMLElement>(close);
  return (
    <section
      ref={ref}
      class="sheet overlay-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <header class="card-head">
        <h2 class="sheet-title" tabIndex={-1}>
          {title}
        </h2>
        <button type="button" class="icon-button" aria-label={strings.map.close} onClick={close}>
          ✕
        </button>
      </header>
      {children}
    </section>
  );
}

function houseRows(houseKey: string): Row[] {
  return current.value?.rows.filter((row) => row.houseKey === houseKey) ?? [];
}

/** The note editor (§5.6): for every row at the house, or for one row. Closing it unwritten is fine. */
function NoteEditor({ houseKey, rowId }: { houseKey: string; rowId: string | null }) {
  const text = useSignal('');
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);
  const loaded = current.value;
  if (!loaded) return null;
  const rows = houseRows(houseKey);
  const row = rows.find((candidate) => candidate.rowId === rowId);
  const title = row
    ? strings.noteEditor.forRow(nameOf(row, loaded.campaign.roles))
    : strings.noteEditor.forHouse(rows.length, addressOf(rows, loaded.campaign.roles));
  return (
    <SheetFrame title={title}>
      <textarea
        ref={field}
        class="note-field"
        aria-label={title}
        rows={4}
        value={text.value}
        onInput={(event) => {
          text.value = event.currentTarget.value;
        }}
      />
      <div class="row-actions">
        <button
          type="button"
          class="button primary"
          onClick={() => {
            close();
            if (text.value.trim()) void saveNote(houseKey, rowId, text.value);
          }}
        >
          {strings.noteEditor.save}
        </button>
        <button type="button" class="button" onClick={close}>
          {strings.cancel}
        </button>
      </div>
    </SheetFrame>
  );
}

/** The number chooser (§5.3): call one, or say which one was called. */
function NumberChooser({ houseKey, mode }: { houseKey: string; mode: 'call' | 'log' }) {
  const loaded = current.value;
  if (!loaded) return null;
  const { campaign } = loaded;
  const numbers = houseNumbers(houseRows(houseKey), campaign.columnOrder, campaign.roles, (row) =>
    nameOf(row, campaign.roles),
  );
  return (
    <SheetFrame title={mode === 'call' ? strings.calls.choose : strings.calls.chooseToLog}>
      {numbers.length === 0 && <p class="muted">{strings.card.noNumber}</p>}
      <ul class="sheet-list">
        {numbers.map((number) => (
          <li key={number.digits}>
            <button
              type="button"
              class="result"
              onClick={() => {
                if (mode === 'call') {
                  close();
                  void dial(houseKey, number);
                } else {
                  sheet.value = {
                    kind: 'outcome',
                    houseKey,
                    pendingId: null,
                    number: number.display,
                  };
                }
              }}
            >
              {numberText(number)}
            </button>
          </li>
        ))}
        {mode === 'log' && (
          <li>
            <button
              type="button"
              class="result"
              onClick={() => {
                sheet.value = { kind: 'outcome', houseKey, pendingId: null, number: null };
              }}
            >
              {strings.calls.wholeHouse}
            </button>
          </li>
        )}
      </ul>
    </SheetFrame>
  );
}

/** The call outcome sheet (§5.5): one tap logs Call date and call result. */
function CallOutcome({
  houseKey,
  pendingId,
  number,
}: {
  houseKey: string;
  pendingId: string | null;
  number: string | null;
}) {
  const outcomes = settings.value?.callOutcomes ?? [];
  return (
    <SheetFrame title={strings.calls.outcome(number)}>
      <div class="outcomes">
        {outcomes.map((outcome) => (
          <button
            key={outcome}
            type="button"
            class="button"
            onClick={() => {
              close();
              if (pendingId) void answerCall(pendingId, outcome);
              else void logCallOutcome(houseKey, number, outcome);
            }}
          >
            {outcome}
          </button>
        ))}
      </div>
      {pendingId && (
        <button
          type="button"
          class="button"
          onClick={() => {
            close();
            void dropCall(pendingId);
          }}
        >
          {strings.calls.discard}
        </button>
      )}
    </SheetFrame>
  );
}

function DeleteNote({ noteEventId }: { noteEventId: string }) {
  return (
    <SheetFrame title={strings.noteEditor.deleteTitle}>
      <p>{strings.noteEditor.deleteBody}</p>
      <div class="row-actions">
        <button
          type="button"
          class="button primary"
          onClick={() => {
            close();
            void removeNote(noteEventId);
          }}
        >
          {strings.noteEditor.delete}
        </button>
        <button type="button" class="button" onClick={close}>
          {strings.cancel}
        </button>
      </div>
    </SheetFrame>
  );
}

interface FormField extends LayoutField {
  key: string;
}

/**
 * Edit info and Edit this row (§5.11): every field once where it is shared, per owner otherwise;
 * the right keyboard for phones and email; Next goes field to field. Save writes one event.
 */
function EditForm({ houseKey, rowId }: { houseKey: string; rowId: string | null }) {
  const values = useSignal<Record<string, string>>({});
  const ref = useDialog<HTMLElement>(close);
  const loaded = current.value;
  if (!loaded) return null;
  const { campaign } = loaded;
  const rows = houseRows(houseKey);
  const row = rows.find((candidate) => candidate.rowId === rowId);
  const phones = new Set(phoneColumns(campaign.columnOrder, campaign.roles));
  const keyOf = (field: LayoutField) => `${field.column}\u0000${field.rowIds.join()}`;

  const sections: { title: string; fields: FormField[] }[] = [];
  if (row) {
    sections.push({
      title: nameOf(row, campaign.roles),
      fields: editableColumns(campaign).map((entry) => {
        const field: LayoutField = {
          column: entry.column,
          value: currentValue(row, entry.column),
          rowIds: [row.rowId],
          differs: false,
          edited: entry.column in row.edits,
        };
        return { ...field, key: keyOf(field) };
      }),
    });
  } else {
    const layout = editLayout(rows, campaign);
    const withKey = (fields: readonly LayoutField[]) =>
      fields.map((field) => ({ ...field, key: keyOf(field) }));
    if (layout.house.length > 0)
      sections.push({ title: strings.edit.house, fields: withKey(layout.house) });
    for (const owner of layout.people)
      sections.push({ title: owner.name || strings.noName, fields: withKey(owner.fields) });
    for (const parcel of layout.parcels)
      sections.push({
        title: strings.edit.parcel(parcel.parcelId),
        fields: withKey(parcel.fields),
      });
  }
  const all = sections.flatMap((section) => section.fields);
  // A shared field the rows disagree on shows once per row: say whose value each one is.
  const differsFor = (field: LayoutField) => {
    const owner = rows.find((candidate) => candidate.rowId === field.rowIds[0]);
    return owner
      ? `${strings.edit.differs}: ${nameOf(owner, campaign.roles)}`
      : strings.edit.differs;
  };
  const title = row
    ? strings.edit.rowTitle(nameOf(row, campaign.roles))
    : strings.edit.title(addressOf(rows, campaign.roles));

  const save = async () => {
    const writes: EditWrite[] = all
      .filter((field) => field.key in values.value && values.value[field.key] !== field.value)
      .map((field) => ({
        rowIds: field.rowIds,
        column: field.column,
        value: values.value[field.key] ?? field.value,
      }));
    if (writes.length === 0) {
      close();
      return;
    }
    if (await saveEdits(houseKey, row ? 'row' : 'house', writes)) close();
  };

  return (
    <section
      ref={ref}
      class="sheet overlay-sheet edit-form"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <header class="card-head">
        <h2 class="sheet-title" tabIndex={-1}>
          {title}
        </h2>
        <button type="button" class="icon-button" aria-label={strings.map.close} onClick={close}>
          ✕
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {!row && <PinHereButton houseKey={houseKey} />}
        {sections.map((section) => (
          <fieldset key={section.title} class="edit-section">
            <legend>{section.title}</legend>
            {section.fields.map((field, i) => {
              const last = field === all.at(-1);
              const isPhone = phones.has(field.column);
              const isEmail = field.column === campaign.roles.email;
              return (
                <label key={field.key} class="field">
                  <span>
                    {field.column}
                    {field.differs && <span class="muted"> ({differsFor(field)})</span>}
                    {field.edited && <span class="muted"> · {strings.card.edited}</span>}
                  </span>
                  <input
                    class="text-input"
                    type={isPhone ? 'tel' : isEmail ? 'email' : 'text'}
                    inputMode={isPhone ? 'tel' : isEmail ? 'email' : 'text'}
                    enterKeyHint={last ? 'done' : 'next'}
                    autoComplete="off"
                    value={values.value[field.key] ?? field.value}
                    data-index={i}
                    onInput={(event) => {
                      values.value = { ...values.value, [field.key]: event.currentTarget.value };
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || last) return;
                      event.preventDefault();
                      const inputs = [
                        ...(event.currentTarget.form?.querySelectorAll('input') ?? []),
                      ];
                      inputs[inputs.indexOf(event.currentTarget) + 1]?.focus();
                    }}
                  />
                </label>
              );
            })}
          </fieldset>
        ))}
        <div class="actions">
          <button type="submit" class="button primary">
            {strings.edit.save}
          </button>
          <button type="button" class="button" onClick={close}>
            {strings.cancel}
          </button>
        </div>
      </form>
    </section>
  );
}

/** Whichever sheet is open over the card. */
export function Sheets() {
  const open: Sheet | null = sheet.value;
  if (!open) return null;
  switch (open.kind) {
    case 'note':
      return (
        <NoteEditor
          key={`${open.houseKey}:${open.rowId ?? ''}`}
          houseKey={open.houseKey}
          rowId={open.rowId}
        />
      );
    case 'numbers':
      return <NumberChooser houseKey={open.houseKey} mode={open.mode} />;
    case 'outcome':
      return (
        <CallOutcome houseKey={open.houseKey} pendingId={open.pendingId} number={open.number} />
      );
    case 'deleteNote':
      return <DeleteNote noteEventId={open.noteEventId} />;
    case 'editHouse':
      return <EditForm key={open.houseKey} houseKey={open.houseKey} rowId={null} />;
    case 'editRow':
      return <EditForm key={open.rowId} houseKey={open.houseKey} rowId={open.rowId} />;
  }
}

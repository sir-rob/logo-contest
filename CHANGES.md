# Frontend seam fixes — change record

All changes are **already applied in the repo** at
`/usr/local/google/home/saurabhma/cowork_workspace/projects/North 7 Logo Contest`
(I edited in place; the project folder is the repo root).

Full file contents published to shared artifacts:
- `apps/web/src/main.tsx`
- `apps/web/src/components/PhaseBanner.tsx`
- `apps/web/src/pages/Admin.tsx`

The two larger files (`MyEntry.tsx` 755 lines, `ModerationTab.tsx` 369 lines) are
recorded here as exact hunks rather than full copies, to avoid transcription risk.

> **Clobbering warning:** `Admin.tsx` and `ModerationTab.tsx` were each silently
> reverted **twice** during this run by concurrent workers writing the same files.
> I re-applied both and re-verified. If the Admin export error or the
> ConfirmDialog error reappears, a later worker overwrote them — re-apply the
> hunks below.

---

## 1. `apps/web/src/pages/Admin.tsx` — export convention

Majority convention across pages is `export function <FileName>` + `export default`.
`Admin.tsx` was the only page whose named export (`AdminPage`) did not match its
file name, so `App.tsx`'s `import { Admin }` failed.

```diff
-export function AdminPage(): JSX.Element {
+export function Admin(): JSX.Element {
   const { status, isAdmin, me } = useAuth();
```

```diff
-export default AdminPage;
+// Named export matches the file name, as on every other page. The `AdminPage`
+// alias is kept so `./AdminPage` can keep re-exporting it.
+export { Admin as AdminPage };
+export default Admin;
```

The `AdminPage` alias is required: `pages/AdminPage.tsx` does
`export { AdminPage, default } from './Admin';`.

---

## 2. `apps/web/src/components/PhaseBanner.tsx` — Countdown takes ISO strings

```diff
             <Countdown
-              to={next.at}
+              to={next.at.toISOString()}
               serverNow={contest.serverNow}
```

Converted at the call site. `Countdown` was left untouched — it takes ISO-8601
strings deliberately so the clock stays anchored to server time.

---

## 3. `apps/web/src/main.tsx` — dead ThemeProvider

`components/ui/accent-toggle.tsx` is self-contained: accent state lives in a
module-level store with a bare `useAccent()` hook that writes `data-accent` on
`<html>` plus localStorage. There is **no provider to mount**, so the import and
the `<ThemeProvider>` wrapper were both removed and the doc comment updated.

---

## 4. `apps/web/src/pages/MyEntry.tsx` — JSX passed to a `string` prop

`Field.hint` is `string` by design. The live character counter is rich content,
so it moved into `children` alongside the control — which is exactly the pattern
`ModerationTab.tsx` already used. `Field` was **not** widened to `ReactNode`.

### Hunk A — Title field (~line 408)
```diff
             <Field
               label="Title"
               htmlFor="entry-title"
-              hint={<CharCount value={title} max={MAX_TITLE_LENGTH} />}
               error={
```

### Hunk B — Title field children (~line 430)
```diff
                 }}
               />
+              {/* `Field.hint` is plain text by design; the live counter is rich
+                  content, so it rides alongside the control in `children`. */}
+              <CharCount value={title} max={MAX_TITLE_LENGTH} />
             </Field>
           </div>
```

### Hunk C — Description field (~line 437)
```diff
           <Field
             label="Description"
             htmlFor="entry-description"
-            hint={<CharCount value={description} max={MAX_DESCRIPTION_LENGTH} />}
             error={
```

### Hunk D — Description field children (~line 461)
```diff
                 setFailure((current) => (current?.field === 'description' ? null : current));
               }}
             />
+            <CharCount value={description} max={MAX_DESCRIPTION_LENGTH} />
           </Field>
```

`CharCount` is safe as a `Field` child: `Field` clones element children to push
`id`/`aria-*` down, and `CharCount` destructures only `value`/`max`, so nothing
is spread onto the DOM and no duplicate `id` is emitted.

---

## 5. `apps/web/src/pages/admin/ModerationTab.tsx` — ConfirmDialog took children

`ConfirmDialogProps` has no `children`. It is a confirmation, not a form.
The disqualification reason now gets written **inline in the entry row**, and the
dialog quotes it back on the confirmation step. `dialog.tsx` was not touched.

### Hunk A — state (~line 44)
```diff
   const [reason, setReason] = React.useState('');
+  const [reasonTouched, setReasonTouched] = React.useState(false);
+  /** Id of the row whose reason form is open, before the confirmation step. */
+  const [pendingId, setPendingId] = React.useState<string | null>(null);
   const [reinstateTarget, setReinstateTarget] = React.useState<ModerationSubmissionDto | null>(null);
```

### Hunk B — row actions (~line 234) — replaced wholesale
```tsx
                  <div className="flex shrink-0 flex-col items-stretch gap-tight sm:w-80">
                    {isDisqualified ? (
                      <Button
                        variant="secondary"
                        onClick={() => setReinstateTarget(entry)}
                        loading={reinstate.isPending && reinstate.variables === entry.id}
                      >
                        Reinstate
                      </Button>
                    ) : pendingId === entry.id ? (
                      // The reason is written here rather than inside the
                      // dialog: ConfirmDialog is a confirmation, not a form, so
                      // the text is captured first and quoted back on confirm.
                      <div className="space-y-tight">
                        <Field
                          label="Reason"
                          htmlFor={`disqualify-reason-${entry.id}`}
                          required
                          hint="Required. Whoever reviews this later — including the entrant, if they ask — sees exactly this text."
                          error={
                            reasonTouched && reasonTooShort
                              ? 'A reason is required to disqualify an entry.'
                              : undefined
                          }
                        >
                          <Textarea
                            id={`disqualify-reason-${entry.id}`}
                            rows={3}
                            maxLength={MAX_REASON}
                            value={reason}
                            onChange={(event) => {
                              setReason(event.target.value);
                              setReasonTouched(true);
                            }}
                            placeholder="e.g. Re-uploaded another member's entry"
                          />
                          <CharCount value={reason} max={MAX_REASON} />
                        </Field>
                        <div className="flex flex-wrap gap-tight">
                          <Button
                            variant="danger"
                            // Kept focusable while incomplete so the reason
                            // requirement is announced rather than silent.
                            aria-disabled={reasonTooShort || undefined}
                            onClick={() => {
                              if (reasonTooShort) {
                                setReasonTouched(true);
                                return;
                              }
                              setTarget(entry);
                            }}
                          >
                            <ShieldAlert aria-hidden className="size-4" />
                            Disqualify
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setPendingId(null);
                              setReason('');
                              setReasonTouched(false);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="danger"
                        onClick={() => {
                          setReason('');
                          setReasonTouched(false);
                          setPendingId(entry.id);
                        }}
                      >
                        <ShieldAlert aria-hidden className="size-4" />
                        Disqualify
                      </Button>
                    )}
                  </div>
```

### Hunk C — disqualify dialog now childless and self-closing
```diff
-            ? `... The reason below is stored with the entry and written to the audit log under your name.`
+            ? `... The reason you gave — “${reason.trim()}” — is stored with the entry and written to the audit log under your name.`
             : undefined
         }
         confirmLabel="Disqualify"
         cancelLabel="Cancel"
         onConfirm={() => {
           if (!target || reasonTooShort) return;
           const id = target.id;
           const why = reason.trim();
           setTarget(null);
+          setPendingId(null);
           setReason('');
+          setReasonTouched(false);
           disqualify.mutate({ id, why });
         }}
-      >
-        ... <Field>/<Textarea>/<CharCount> reason form ...
-      </ConfirmDialog>
+      />
```

Accessibility preserved: the reason keeps its `Field` label/hint/error wiring and
char counter, the destructive confirmation step is retained, and the incomplete
Disqualify button stays focusable with `aria-disabled` rather than going `disabled`
so the requirement is announced instead of silently ignored.

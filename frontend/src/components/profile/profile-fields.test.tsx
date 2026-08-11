/**
 * The education card's list behaviour. Issue 128 was filed against the old shape — five rows
 * of four permanently-open inputs, no way to drop one, and five fields all called "School" —
 * and the entry-list rewrite answered it. Nothing held that answer down, so this does.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { messages, renderWithIntl } from '../../test/render';

import { EMPTY_ROW, type EducationDraft } from './education-draft';
import { EducationFields } from './profile-fields';

function entry(school: string, fields: Partial<EducationDraft> = {}): EducationDraft {
  return { ...EMPTY_ROW, school, ...fields };
}

const ROWS = [
  entry('Cambridge', { degree: 'BSc', field: 'Mathematics', endYear: '2019' }),
  entry('Bogazici', { degree: 'MSc', field: 'Physics', startYear: '2019', endYear: '2021' }),
  entry('Delft', { degree: 'PhD', field: 'Optics', startYear: '2021' }),
];

/** The component is controlled, so the test owns the list the same way the screens do. */
function setup(initial: EducationDraft[] = ROWS) {
  const onCommit = vi.fn<(rows: EducationDraft[]) => void>();

  function Harness() {
    const [rows, setRows] = useState(initial);
    return <EducationFields rows={rows} onChange={setRows} onCommit={onCommit} />;
  }

  renderWithIntl(<Harness />);
  return { onCommit, user: userEvent.setup() };
}

/** `Remove {school}` / `Edit {school}` as the button actually announces them. */
const named = (key: 'removeEntryLabel' | 'editEntryLabel', school: string) =>
  messages.fields[key].replace('{school}', school);

describe('removing an education entry', () => {
  it('drops the one asked for and leaves the others whole', async () => {
    const { onCommit, user } = setup();

    await user.click(screen.getByRole('button', { name: named('removeEntryLabel', 'Bogazici') }));
    await user.click(screen.getByRole('button', { name: messages.fields.removeEntryAction }));

    expect(onCommit).toHaveBeenCalledWith([ROWS[0], ROWS[2]]);

    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(screen.queryByText('Bogazici')).toBeNull();

    // Not just "the other two survived" — they survived unedited. A splice that rebuilt the
    // list from the form's draft would still leave two cards standing.
    expect(within(cards[0]).getByText('BSc, Mathematics')).toBeInTheDocument();
    expect(within(cards[0]).getByText('2019')).toBeInTheDocument();
    expect(within(cards[1]).getByText('PhD, Optics')).toBeInTheDocument();
    expect(within(cards[1]).getByText('2021 –')).toBeInTheDocument();
  });

  it('asks first, and keeps the entry when the answer is no', async () => {
    const { onCommit, user } = setup();

    await user.click(screen.getByRole('button', { name: named('removeEntryLabel', 'Delft') }));
    expect(screen.getByText(messages.fields.removeEntryConfirm)).toBeInTheDocument();
    expect(screen.getByText('Delft')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: messages.fields.entryCancel }));

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Delft')).toBeInTheDocument();
  });

  it('offers removal for a lone entry, and empties the card down to its empty state', async () => {
    const { onCommit, user } = setup([ROWS[0]]);

    await user.click(screen.getByRole('button', { name: named('removeEntryLabel', 'Cambridge') }));
    await user.click(screen.getByRole('button', { name: messages.fields.removeEntryAction }));

    expect(onCommit).toHaveBeenCalledWith([]);
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.getByText(messages.fields.educationEmpty)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: messages.fields.addEducationRow })).toBeInTheDocument();
  });
});

// The other half of 128: a forms rotor that listed four fields all called "School". The entry
// list answers it by never having two open at once, so that is what gets asserted — the
// component would have to go back to a row of open inputs to break it.
describe('the education card names one School field at a time', () => {
  /** By accessible name, which is what the rotor reads — the label's `*` is `aria-hidden`. */
  const schoolFields = () =>
    screen.queryAllByRole('textbox', { name: messages.fields.schoolLabel });

  it('shows no open fields until an entry is opened', async () => {
    const { user } = setup();

    expect(schoolFields()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: named('editEntryLabel', 'Bogazici') }));

    expect(schoolFields()).toHaveLength(1);
    expect(schoolFields()[0]).toHaveValue('Bogazici');
  });

  it('closes the entry it was editing when another is opened', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: named('editEntryLabel', 'Cambridge') }));
    await user.click(screen.getByRole('button', { name: messages.fields.entryCancel }));
    await user.click(screen.getByRole('button', { name: named('editEntryLabel', 'Delft') }));

    expect(schoolFields()).toHaveLength(1);
    expect(schoolFields()[0]).toHaveValue('Delft');
  });

  it('keeps the add form to one School field too', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: messages.fields.addEducationRow }));

    expect(schoolFields()).toHaveLength(1);
    expect(schoolFields()[0]).toHaveValue('');
  });
});

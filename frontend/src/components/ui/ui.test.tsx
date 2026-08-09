import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { messages, renderWithIntl } from '../../test/render';

import { Button, Field, FileInput, Input, Select } from './index';

describe('<Button>', () => {
  it('keeps its label mounted while loading so the width holds', () => {
    renderWithIntl(<Button loading>Start</Button>);
    const button = screen.getByRole('button', { name: 'Start' });

    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Start');
  });

  it('is not busy and not disabled at rest', () => {
    const onClick = vi.fn();
    renderWithIntl(<Button onClick={onClick}>Start</Button>);
    const button = screen.getByRole('button', { name: 'Start' });

    expect(button).not.toHaveAttribute('aria-busy');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('defaults to type=button so it never submits a form by accident', () => {
    renderWithIntl(<Button>Start</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});

describe('<Field>', () => {
  it('wires the label, the hint and the error onto the control', () => {
    renderWithIntl(
      <Field label="Email" hint="Work address" error="That is not an email" id="email">
        {(control) => <Input type="email" {...control} />}
      </Field>,
    );

    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Work address That is not an email');
  });

  it('announces the error, which describedby alone does not do after submit', () => {
    renderWithIntl(
      <Field label="Email" error="That is not an email" id="email">
        {(control) => <Input type="email" {...control} />}
      </Field>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('That is not an email');
  });

  it('leaves aria-invalid and describedby off when there is nothing to say', () => {
    renderWithIntl(
      <Field label="Occupation">{(control) => <Input {...control} />}</Field>,
    );

    const input = screen.getByLabelText('Occupation');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });
});

// Issue 145: a masked field with a typo can only be checked by retyping it. The toggle lives
// in the primitive so the target size and the focus ring come from the same place as every
// other control's.
describe('<Input reveal>', () => {
  const render = () =>
    renderWithIntl(
      <Field label="Password" id="password">
        {(control) => <Input {...control} type="password" reveal />}
      </Field>,
    );

  it('switches the input between password and text', async () => {
    const user = userEvent.setup();
    render();
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: messages.common.showPassword }));
    expect(input).toHaveAttribute('type', 'text');

    // The name reflects what the next press does, so it has to change with the state.
    await user.click(screen.getByRole('button', { name: messages.common.hidePassword }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('is a button, not a submit, and follows the field into disabled', () => {
    renderWithIntl(
      <Field label="Password" id="password">
        {(control) => <Input {...control} type="password" reveal disabled />}
      </Field>,
    );

    const toggle = screen.getByRole('button', { name: messages.common.showPassword });
    // A submit here would post the form on a reveal.
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toBeDisabled();
  });

  it('leaves an ordinary input untouched', () => {
    renderWithIntl(
      <Field label="Email" id="email">
        {(control) => <Input {...control} type="email" />}
      </Field>,
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
  });
});

describe('<Select>', () => {
  it('renders a native select, never a listbox widget', () => {
    renderWithIntl(
      <Field label="Language" id="lang">
        {(control) => (
          <Select {...control} defaultValue="tr">
            <option value="en">EN</option>
            <option value="tr">TR</option>
          </Select>
        )}
      </Field>,
    );

    const select = screen.getByLabelText('Language');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveValue('tr');
  });
});

describe('<FileInput>', () => {
  const pdf = () => new File(['%PDF-1.4'], 'listing.pdf', { type: 'application/pdf' });

  it('keeps a focusable input behind the drop target', () => {
    renderWithIntl(<FileInput onFile={vi.fn()} />);
    const input = screen.getByLabelText(new RegExp(messages.common.chooseFile));

    expect(input).toHaveAttribute('type', 'file');
    expect(input).not.toHaveAttribute('aria-invalid');
    input.focus();
    expect(input).toHaveFocus();
  });

  it('marks the hidden input invalid so the danger border has a semantic twin', () => {
    renderWithIntl(<FileInput invalid onFile={vi.fn()} />);
    expect(screen.getByLabelText(new RegExp(messages.common.chooseFile))).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  // Issue 140: the server refuses over 10 MB, but only after the browser has streamed the
  // whole file. The guard is a courtesy — the server checks are still the boundary.
  it('refuses a file over the limit without handing it to the caller', () => {
    const onFile = vi.fn();
    const onReject = vi.fn();
    renderWithIntl(<FileInput onFile={onFile} onReject={onReject} maxBytes={8} />);
    const input = screen.getByLabelText(new RegExp(messages.common.chooseFile));

    fireEvent.change(input, { target: { files: [new File(['%PDF-1.4 too big'], 'big.pdf')] } });

    expect(onReject).toHaveBeenCalledWith('UPLOAD_TOO_LARGE');
    expect(onFile).toHaveBeenCalledWith(null);
    expect(onFile).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'big.pdf' }));
    // The picker is reset too, so re-picking the same file fires a fresh change event.
    expect(screen.getByText(messages.common.noFileChosen)).toBeInTheDocument();
  });

  it('accepts a file at the limit — the cap is a ceiling, not a fence', () => {
    const onFile = vi.fn();
    const onReject = vi.fn();
    renderWithIntl(<FileInput onFile={onFile} onReject={onReject} maxBytes={8} />);
    const input = screen.getByLabelText(new RegExp(messages.common.chooseFile));

    fireEvent.change(input, { target: { files: [new File(['%PDF-1.4'], 'exact.pdf')] } });

    expect(onReject).not.toHaveBeenCalled();
    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'exact.pdf' }));
  });

  it('names the chosen file and clears it back to the empty hint', () => {
    const onFile = vi.fn();
    renderWithIntl(<FileInput onFile={onFile} />);
    const input = screen.getByLabelText(new RegExp(messages.common.chooseFile));

    expect(screen.getByText(messages.common.noFileChosen)).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [pdf()] } });
    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'listing.pdf' }));
    expect(screen.getByText('listing.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: messages.common.clearFile }));
    expect(onFile).toHaveBeenLastCalledWith(null);
    expect(screen.getByText(messages.common.noFileChosen)).toBeInTheDocument();
  });
});

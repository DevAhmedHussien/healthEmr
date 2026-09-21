'use client';

import * as React from 'react';
import {
  FormProvider,
  useForm,
  type DefaultValues,
  type FieldValues,
  type UseFormReturn,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodSchema } from 'zod';

/**
 * Wraps a form in React Hook Form with the same Zod schema the API validates
 * against, imported from `packages/types`.
 *
 * One schema, both sides: a rule cannot be enforced on the server and forgotten
 * on the client, because there is only one place it is written down.
 *
 * Validation runs on blur rather than on every keystroke — telling someone their
 * email is invalid while they are still typing it is noise, not help.
 */
export function Form<T extends FieldValues>({
  schema,
  defaultValues,
  onSubmit,
  children,
  id,
  className = 'space-y-6',
}: {
  schema: ZodSchema<T>;
  defaultValues: DefaultValues<T>;
  onSubmit: (values: T, form: UseFormReturn<T>) => void | Promise<void>;
  children: React.ReactNode | ((form: UseFormReturn<T>) => React.ReactNode);
  /**
   * Names the form so a submit button can sit outside it.
   *
   * A dialog puts its confirm button in the footer, below the scrolling body —
   * so the button is not a descendant of the form. `<button form="…">` is the
   * plain HTML answer, and it keeps Enter-to-submit working, which wiring an
   * onClick through a ref would not.
   */
  id?: string;
  className?: string;
}) {
  const form = useForm<T>({
    resolver: zodResolver(schema as never),
    defaultValues,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  return (
    <FormProvider {...form}>
      <form
        id={id}
        onSubmit={form.handleSubmit((values) => onSubmit(values, form))}
        noValidate
        className={className}
      >
        {typeof children === 'function' ? children(form) : children}
      </form>
    </FormProvider>
  );
}

export { useFormContext } from 'react-hook-form';

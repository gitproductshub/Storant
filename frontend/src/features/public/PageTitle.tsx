import React from 'react';
import Head from 'expo-router/head';
import { pageTitle } from '@/config/brand';

/** Sets the browser tab title (and description) on web; no-op on native. */
export function PageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <Head>
      <title>{pageTitle(title)}</title>
      {description ? <meta name="description" content={description} /> : null}
    </Head>
  );
}

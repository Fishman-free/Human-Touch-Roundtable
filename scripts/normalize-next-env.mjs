import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Next 16 switches these imports between .next/dev/types and .next/types based
// on local cache state. Keep the tracked file deterministic for collaborators.
const content = `/// <reference types="next" />
/// <reference types="next/image-types/global" />
import "./.next/types/routes.d.ts";
import "./.next/types/root-params.d.ts";

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`;
await writeFile(resolve(import.meta.dirname, '..', 'next-env.d.ts'), content, 'utf8');

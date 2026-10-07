import type { APIRoute, GetStaticPaths } from 'astro';
import { canned } from '../../../data/lab';

export const getStaticPaths: GetStaticPaths = () => Object.keys(canned).map((id) => ({ params: { id } }));

export const GET: APIRoute = ({ params }) =>
  new Response(JSON.stringify(canned[params.id as keyof typeof canned]), { headers: { 'Content-Type': 'application/json' } });

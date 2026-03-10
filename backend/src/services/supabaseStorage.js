const fs = require('fs');
const path = require('path');
const {createClient} = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET;

const isStorageConfigured = () =>
  Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && SUPABASE_STORAGE_BUCKET);

const getClient = () => {
  if (!isStorageConfigured()) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {persistSession: false},
  });
};

const buildStoragePath = (recordId, fileName) => {
  const safeName = String(fileName || 'audio').replace(/\\/g, '/');
  return path.posix.join('audio_records', String(recordId), safeName);
};

async function uploadAudioFile({filePath, fileName, recordId, mimeType}) {
  const client = getClient();
  if (!client) return null;

  const storagePath = buildStoragePath(recordId, fileName);
  const buffer = fs.readFileSync(filePath);

  const {error: uploadError} = await client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType || 'application/octet-stream',
      upsert: true,
    });

  if (uploadError) {
    throw uploadError;
  }

  const {data: publicData} = client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .getPublicUrl(storagePath);

  return {
    storagePath,
    publicUrl: publicData?.publicUrl || null,
  };
}

async function createSignedAudioUrl(storagePath, expiresInSeconds = 600) {
  const client = getClient();
  if (!client) return null;

  const {data, error} = await client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error) {
    return null;
  }

  return data?.signedUrl || null;
}

module.exports = {
  isStorageConfigured,
  uploadAudioFile,
  createSignedAudioUrl,
};

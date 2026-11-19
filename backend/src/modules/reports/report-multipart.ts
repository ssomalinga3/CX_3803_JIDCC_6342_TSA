import busboy from 'busboy';
import { PHOTO_LIMITS } from './photo-errors.js';
import { ReportError } from './report-input.js';

/** The route's raw parser bounds the *complete* multipart body before this parser runs. */
export function reportMultipart(
  body: Buffer,
  contentType: string,
): Promise<{ metadata: unknown; images: Uint8Array[] }> {
  return new Promise((resolve, reject) => {
    let metadata: string | undefined, failure: ReportError | undefined;
    const images: Buffer[] = [];
    const fail = (code = 'INVALID_REPORT', status = 400) => {
      failure ??= new ReportError(code, status);
    };
    let parser;
    try {
      parser = busboy({
        headers: { 'content-type': contentType },
        limits: {
          files: 3,
          fields: 2,
          parts: 5,
          fieldSize: 64 * 1024,
          fileSize: PHOTO_LIMITS.bytes + 1,
          fieldNameSize: 80,
        },
      });
    } catch {
      reject(new ReportError('INVALID_REPORT', 400));
      return;
    }
    parser.on('field', (name, value, info) => {
      if (name !== 'metadata' || metadata !== undefined) {
        fail();
        return;
      }
      if (info.valueTruncated || info.nameTruncated) {
        fail('PAYLOAD_TOO_LARGE', 413);
        return;
      }
      metadata = value;
    });
    parser.on('file', (name, stream) => {
      if (name !== 'images') {
        fail();
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      const position = images.length;
      images.push(Buffer.alloc(0));
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > PHOTO_LIMITS.bytes) fail('PHOTO_TOO_LARGE', 413);
        if (!failure) chunks.push(chunk);
      });
      stream.on('limit', () => fail('PHOTO_TOO_LARGE', 413));
      stream.on('error', () => fail());
      stream.on('end', () => {
        if (!failure) images[position] = Buffer.concat(chunks, size);
      });
    });
    parser.on('filesLimit', () => fail('INVALID_PHOTO_COUNT'));
    parser.on('fieldsLimit', () => fail());
    parser.on('partsLimit', () => fail());
    parser.on('error', () => reject(new ReportError('INVALID_REPORT', 400)));
    parser.on('close', () => {
      if (failure) {
        reject(failure);
        return;
      }
      if (metadata === undefined || images.length < 1) {
        reject(new ReportError('INVALID_REPORT', 400));
        return;
      }
      try {
        resolve({ metadata: JSON.parse(metadata) as unknown, images });
      } catch {
        reject(new ReportError('INVALID_REPORT', 400));
      }
    });
    parser.end(body);
  });
}

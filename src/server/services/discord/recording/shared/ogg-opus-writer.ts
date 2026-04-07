import type { WriteStream } from "fs";
import { getOpusPacketSampleCount } from "./opus.utils";

// OGG CRC32 lookup table - polynomial 0x04C11DB7, direct (non-reflected)
const CRC_TABLE: number[] = new Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i << 24;
  for (let j = 0; j < 8; j++) {
    crc = crc & 0x80000000
      ? ((crc << 1) ^ 0x04c11db7) >>> 0
      : (crc << 1) >>> 0;
  }
  CRC_TABLE[i] = crc >>> 0;
}

function computeOggCrc32(data: Buffer): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC_TABLE[((crc >>> 24) ^ data[i]) & 0xff] ^ (crc << 8)) >>> 0;
  }
  return crc >>> 0;
}

const OGG_HEADER_FLAG_BOS = 0x02;
const OGG_HEADER_FLAG_EOS = 0x04;

interface OggOpusWriterOptions {
  sampleRate: number;
  channels: number;
  serialNumber?: number;
}

export class OggOpusWriter {
  private stream: WriteStream;
  private serialNumber: number;
  private pageSequenceNumber = 0;
  private granulePosition = 0n;
  private sampleRate: number;
  private channels: number;
  private closed = false;

  constructor(stream: WriteStream, options: OggOpusWriterOptions) {
    this.stream = stream;
    this.sampleRate = options.sampleRate;
    this.channels = options.channels;
    this.serialNumber =
      options.serialNumber ?? Math.floor(Math.random() * 0xffffffff);

    this.writeOpusHeadPage();
    this.writeOpusTagsPage();
  }

  writePacket(opusData: Buffer): void {
    if (this.closed) {
      return;
    }

    this.granulePosition += BigInt(getOpusPacketSampleCount(opusData));
    this.writePage(opusData, 0x00, this.granulePosition);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.writePage(Buffer.alloc(0), OGG_HEADER_FLAG_EOS, this.granulePosition);
    this.stream.end();
  }

  private writeOpusHeadPage(): void {
    const head = Buffer.alloc(19);
    head.write("OpusHead", 0, 8, "ascii");
    head.writeUInt8(1, 8);
    head.writeUInt8(this.channels, 9);
    head.writeUInt16LE(0, 10);
    head.writeUInt32LE(this.sampleRate, 12);
    head.writeInt16LE(0, 16);
    head.writeUInt8(0, 18);

    this.writePage(head, OGG_HEADER_FLAG_BOS, 0n);
  }

  private writeOpusTagsPage(): void {
    const vendor = "elohr-recorder";
    const vendorBuffer = Buffer.from(vendor, "utf-8");
    const tags = Buffer.alloc(8 + 4 + vendorBuffer.length + 4);

    let offset = 0;
    tags.write("OpusTags", offset, 8, "ascii");
    offset += 8;
    tags.writeUInt32LE(vendorBuffer.length, offset);
    offset += 4;
    vendorBuffer.copy(tags, offset);
    offset += vendorBuffer.length;
    tags.writeUInt32LE(0, offset);

    this.writePage(tags, 0x00, 0n);
  }

  private writePage(
    packetData: Buffer,
    headerType: number,
    granule: bigint,
  ): void {
    const segmentSizes: number[] = [];
    let remaining = packetData.length;

    if (remaining === 0) {
      segmentSizes.push(0);
    } else {
      while (remaining >= 255) {
        segmentSizes.push(255);
        remaining -= 255;
      }
      segmentSizes.push(remaining);
    }

    const headerSize = 27 + segmentSizes.length;
    const page = Buffer.alloc(headerSize + packetData.length);

    let offset = 0;

    page.write("OggS", offset, 4, "ascii");
    offset += 4;
    page.writeUInt8(0, offset);
    offset += 1;
    page.writeUInt8(headerType, offset);
    offset += 1;
    page.writeBigInt64LE(granule, offset);
    offset += 8;
    page.writeUInt32LE(this.serialNumber, offset);
    offset += 4;
    page.writeUInt32LE(this.pageSequenceNumber++, offset);
    offset += 4;
    page.writeUInt32LE(0, offset);
    offset += 4;
    page.writeUInt8(segmentSizes.length, offset);
    offset += 1;

    for (const segmentSize of segmentSizes) {
      page.writeUInt8(segmentSize, offset);
      offset += 1;
    }

    packetData.copy(page, offset);

    const crc = computeOggCrc32(page);
    page.writeUInt32LE(crc, 22);
    this.stream.write(page);
  }
}
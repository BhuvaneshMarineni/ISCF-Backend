const { Router } = require('express');
const { prisma } = require('../lib/db');
const { getPublicImageUrl } = require('../lib/r2');

const router = Router();

function serializePhoto(photo) {
  return {
    id: photo.id,
    albumId: photo.albumId,
    imageKey: photo.imageKey,
    publicUrl: getPublicImageUrl(photo.imageKey),
    caption: photo.caption,
    altText: photo.altText,
    isCover: photo.isCover,
    isFeatured: photo.isFeatured,
    sortOrder: photo.sortOrder,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const albums = await prisma.galleryAlbum.findMany({
      where: { isPublished: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        category: true,
        eventDate: true,
        location: true,
        sortOrder: true,
        photos: { where: { isCover: true }, select: { imageKey: true }, take: 1 },
        _count: { select: { photos: true } },
      },
    });
    res.json({
      albums: albums.map((album) => {
        const cover = album.photos[0];
        return {
          id: album.id,
          title: album.title,
          slug: album.slug,
          description: album.description,
          category: album.category,
          eventDate: album.eventDate,
          location: album.location,
          sortOrder: album.sortOrder,
          photoCount: album._count.photos,
          coverPhoto: cover ? { imageKey: cover.imageKey, publicUrl: getPublicImageUrl(cover.imageKey) } : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const album = await prisma.galleryAlbum.findFirst({
      where: { slug: req.params.slug, isPublished: true },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        category: true,
        eventDate: true,
        location: true,
        sortOrder: true,
        photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!album) {
      return res.status(404).json({ error: 'Gallery album not found' });
    }
    res.json({
      album: {
        id: album.id,
        title: album.title,
        slug: album.slug,
        description: album.description,
        category: album.category,
        eventDate: album.eventDate,
        location: album.location,
        sortOrder: album.sortOrder,
        photos: album.photos.map(serializePhoto),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

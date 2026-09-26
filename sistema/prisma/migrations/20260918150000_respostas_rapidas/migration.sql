-- CreateTable
CREATE TABLE "QuickReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shortcut" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "QuickReply_shortcut_key" ON "QuickReply"("shortcut");


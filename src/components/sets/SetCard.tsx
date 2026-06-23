import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CalendarDays, Layers } from 'lucide-react'
import { format } from 'date-fns'

interface SetCardProps {
  set: {
    id: string
    title: string
    description?: string | null
    _count?: {
      cards: number
    }
    createdAt: Date
  }
}

export function SetCard({ set }: SetCardProps) {
  const cardCount = set._count?.cards ?? 0

  return (
    <Link href={`/sets/${set.id}`} className="block group">
      <Card className="transition-all hover:shadow-md group-hover:border-primary/50">
        <CardHeader>
          <div className="flex justify-between items-start mb-2">
            <Badge variant="secondary" className="flex gap-1 items-center">
              <Layers className="w-3 h-3" />
              {cardCount} cards
            </Badge>
          </div>
          <CardTitle className="line-clamp-1 group-hover:text-primary transition-colors">
            {set.title}
          </CardTitle>
          <CardDescription className="line-clamp-2 min-h-[2.5rem]">
            {set.description || 'No description provided.'}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-between items-center text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <CalendarDays className="w-3 h-3" />
            {format(new Date(set.createdAt), 'MMM d, yyyy')}
          </div>
          <Button size="sm" variant="ghost" className="h-8 px-2">
            View Set
          </Button>
        </CardFooter>
      </Card>
    </Link>
  )
}
